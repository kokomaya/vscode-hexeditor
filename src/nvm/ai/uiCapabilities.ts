// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * UI capabilities (`caps.ui`): let the AI drive the user's view of the active
 * dump — reveal a block, open a workbench view, filter the Blocks table, apply
 * a layout — and read the user's current focus ("this block"). All operations
 * are view-only (no data is modified), so they run without confirmation.
 *
 * Depends on a minimal {@link WorkbenchDriver} interface rather than on the
 * workbench implementation (dependency inversion).
 */

import { sanitizeTableQuery, TableQuery } from "../../../shared/nvm/views/tableQuery";
import { findBuiltinLayout, BUILTIN_LAYOUTS } from "../../../shared/nvm/workbench/builtinLayouts";
import { NvmFocus, WorkbenchCommand } from "../../../shared/nvm/workbench/commands";
import { validateLayout, WorkbenchMode } from "../../../shared/nvm/workbench/layoutSchema";
import { isWorkbenchViewId, WorkbenchViewIds } from "../../../shared/nvm/workbench/viewIds";
import { MessageType } from "../../../shared/protocol";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { ActiveDump } from "./activeDump";
import { NvmCapabilityError } from "./capabilityTypes";

/** What the UI capabilities need from the workbench host. */
export interface WorkbenchDriver {
	layoutMode(): WorkbenchMode;
	sendCommand(command: WorkbenchCommand): boolean;
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

export const UI_VIEW_IDS = Object.values(WorkbenchViewIds);

export class UiCapabilities {
	constructor(
		private readonly dump: ActiveDump,
		private readonly registry: HexEditorRegistry,
		private readonly workbench?: WorkbenchDriver,
	) {}

	/** Scroll to, select and highlight a block (by name/id) or an offset. */
	public reveal(target: { block?: string; offset?: number }): string {
		const doc = this.dump.doc();
		let offset = target.offset;
		let label = offset !== undefined ? hex(offset) : "";
		if (target.block) {
			const block = this.resolveBlock(target.block);
			offset = block.offset;
			label = `${block.name ?? block.id} @ ${hex(block.offset)}`;
		}
		if (offset === undefined || !Number.isFinite(offset) || offset < 0) {
			throw new NvmCapabilityError("Give a block name or a non-negative offset to reveal.");
		}
		for (const messaging of this.registry.getMessaging(doc)) {
			messaging.sendEvent({ type: MessageType.RevealNvmOffset, offset });
		}
		return `Revealed ${label} in the editor.`;
	}

	/** Open (or focus) a workbench view. */
	public showView(view: string): string {
		if (!isWorkbenchViewId(view)) {
			throw new NvmCapabilityError(`Unknown view "${view}". Valid views: ${UI_VIEW_IDS.join(", ")}.`);
		}
		this.send({ kind: "showView", view });
		return `Opened the ${view} view.`;
	}

	/** Filter / sort / pick columns of the Blocks table (replaces the current query). */
	public filterTable(input: unknown): { query: TableQuery; text: string } {
		const query = sanitizeTableQuery(input);
		if (query.sort || query.columns) {
			const known = this.knownColumnKeys();
			const unknown = [query.sort?.key, ...(query.columns ?? [])].filter(
				(k): k is string => !!k && !known.has(k),
			);
			if (unknown.length) {
				throw new NvmCapabilityError(
					`Unknown column(s): ${unknown.join(", ")}. Available: ${[...known].join(", ")}.`,
				);
			}
		}
		this.send({ kind: "filterTable", query });
		const parts = [
			query.search ? `search "${query.search}"` : undefined,
			query.sort ? `sorted by ${query.sort.key} ${query.sort.dir === -1 ? "desc" : "asc"}` : undefined,
			query.latestOnly ? "latest only" : undefined,
			query.columns ? `${query.columns.length} column(s)` : undefined,
		].filter(Boolean);
		return { query, text: `Blocks table updated${parts.length ? `: ${parts.join(", ")}` : " (filter cleared)"}.` };
	}

	/** Apply a built-in preset (by id or name) or an ad-hoc layout object. */
	public applyLayout(input: { preset?: string; layout?: unknown }): string {
		if (input.preset) {
			const q = input.preset.toLowerCase();
			const preset =
				findBuiltinLayout(input.preset) ??
				BUILTIN_LAYOUTS.find(l => l.name.toLowerCase() === q || l.id.toLowerCase().endsWith(q));
			if (!preset) {
				throw new NvmCapabilityError(
					`Unknown preset "${input.preset}". Presets: ${BUILTIN_LAYOUTS.map(l => `${l.id} (${l.name})`).join(", ")}.`,
				);
			}
			this.send({ kind: "selectPreset", presetId: preset.id });
			return `Switched to the "${preset.name}" layout.`;
		}
		const result = validateLayout(input.layout);
		if (!result.ok) {
			throw new NvmCapabilityError(`Invalid layout: ${result.error}`);
		}
		this.send({ kind: "applyLayout", layout: result.layout });
		return "Applied the layout (the user can restore the preset with Reset).";
	}

	/** Display names of the active dump's blocks (for linking mentions). */
	public blockNames(): string[] {
		return this.dump.blocks().map(b => b.name ?? b.id);
	}

	/** The user's current focus in the active dump, if any. */
	public focus(): NvmFocus | undefined {
		const doc = this.registry.activeDocument;
		return doc ? this.registry.getNvmFocus(doc) : undefined;
	}

	/** One-line focus description for the chat context ("this block"). */
	public describeFocus(): string | undefined {
		const f = this.focus();
		if (!f) {
			return undefined;
		}
		if (!f.blockName) {
			return `The user has selected offset ${hex(f.offset)} (not inside a known block).`;
		}
		const field = f.fieldName ? `, field "${f.fieldName}"` : "";
		return `The user has selected block "${f.blockName}"${field} at offset ${hex(f.offset)}. "This block"/"this" refers to it.`;
	}

	private send(command: WorkbenchCommand): void {
		this.dump.doc();
		if (!this.workbench || this.workbench.layoutMode() !== "workbench") {
			throw new NvmCapabilityError(
				"The NVM workbench is disabled (setting nvmstudio.nvm.layoutMode = classic). Only nvm_reveal is available.",
			);
		}
		if (!this.workbench.sendCommand(command)) {
			throw new NvmCapabilityError("The active dump's editor is not open.");
		}
	}

	/** Exact name/id match preferring the newest instance, else the fuzzy lookup. */
	private resolveBlock(name: string) {
		const q = name.toLowerCase();
		const exact = this.dump.blocks().filter(b => (b.name ?? b.id).toLowerCase() === q || b.id.toLowerCase() === q);
		if (exact.length) {
			return (
				exact.find(b => b.isLatest) ??
				exact.reduce((a, b) => ((b.sequence ?? -1) > (a.sequence ?? -1) ? b : a))
			);
		}
		return this.dump.require(name);
	}

	private knownColumnKeys(): Set<string> {
		const keys = new Set(["__name", "__offset", "__length"]);
		for (const b of this.dump.blocks()) {
			for (const a of b.attributes ?? []) {
				keys.add(a.key);
			}
		}
		return keys;
	}
}
