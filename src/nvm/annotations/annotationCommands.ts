// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Command-driven annotation input (right-click menus + keyboard shortcuts).
 *
 * The commands act on the active dump. Invoked from a Blocks table / tree row
 * context menu, VS Code passes the row's `data-vscode-context`
 * (`nvmBlockId` / `nvmOffset`) and the whole block is the target; otherwise
 * the hex focus / selection is. The webview refreshes itself through
 * `AnnotationService.onDidChange`.
 */

import * as vscode from "vscode";
import { NvmBlockInfo } from "../../../shared/protocol";
import { HexDocument } from "../../hexDocument";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { AnnotationInteractions, PROMPT } from "./annotationInteractions";
import { AnnotationService } from "./annotationService";

/** What a webview row puts into `data-vscode-context`. */
export interface RowContext {
	nvmBlockId?: string;
	nvmOffset?: number;
}

interface Target {
	document: HexDocument;
	/** Inclusive start / exclusive end of the annotated range. */
	start: number;
	end: number;
	/** Suggested label (the block name for a row target). */
	label?: string;
}

const isRowContext = (v: unknown): v is RowContext =>
	!!v && typeof v === "object" && ("nvmBlockId" in v || "nvmOffset" in v);

export function resolveTarget(registry: HexEditorRegistry, context?: unknown): Target | undefined {
	const document = registry.activeDocument;
	if (!document) {
		void vscode.window.showInformationMessage(vscode.l10n.t("No active hex editor."));
		return undefined;
	}
	if (isRowContext(context)) {
		const blocks = registry.getNvmBlocks(document) as NvmBlockInfo[];
		const block =
			blocks.find(b => b.id === context.nvmBlockId) ??
			blocks.find(b => b.offset === context.nvmOffset);
		if (block) {
			return { document, start: block.offset, end: block.offset + Math.max(1, block.length), label: block.name ?? block.id };
		}
	}
	const { focused, selected } = document.selectionState;
	const start = focused ?? 0;
	return { document, start, end: start + Math.max(1, selected || 1) };
}

export function registerAnnotationCommands(
	registry: HexEditorRegistry,
	annotations: AnnotationService,
	interactions: AnnotationInteractions,
): vscode.Disposable[] {
	const withTarget = (run: (t: Target) => Promise<unknown>) => async (context?: unknown) => {
		const t = resolveTarget(registry, context);
		if (t) {
			await run(t);
		}
	};

	return [
		vscode.commands.registerCommand(
			"nvmStudio.nvm.addBookmarkHere",
			withTarget(t =>
				interactions.run(t.document.uri, { kind: "addBookmark", offset: t.start, label: t.label, prompt: true }),
			),
		),
		vscode.commands.registerCommand(
			"nvmStudio.nvm.addNoteHere",
			withTarget(t =>
				interactions.run(t.document.uri, { kind: "addNote", start: t.start, end: t.end, title: t.label, prompt: true }),
			),
		),
		vscode.commands.registerCommand(
			"nvmStudio.nvm.tagSelectionHere",
			withTarget(t =>
				interactions.run(t.document.uri, { kind: "assignTag", tagId: PROMPT, start: t.start, end: t.end }),
			),
		),
		vscode.commands.registerCommand(
			"nvmStudio.nvm.removeTagHere",
			withTarget(async t => {
				const set = await annotations.get(t.document.uri);
				const covering = set.tagAssignments.filter(a => {
					const s = a.anchor.offset;
					const e = a.anchor.endOffset ?? s + 1;
					return t.start < e && s < t.end;
				});
				if (covering.length === 0) {
					void vscode.window.showInformationMessage(vscode.l10n.t("No tag here."));
					return;
				}
				for (const a of covering) {
					await annotations.apply(t.document.uri, { kind: "unassignTag", assignmentId: a.id });
				}
			}),
		),
	];
}
