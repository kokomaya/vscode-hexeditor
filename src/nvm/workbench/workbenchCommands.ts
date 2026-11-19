// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Commands around the workbench: pick / reset a layout, open a view, and the
 * "Ask @nvm about this" entry points (table/tree row and hex context menus).
 * Questions are pre-filled in the chat input, never sent automatically.
 */

import * as vscode from "vscode";
import { WorkbenchViewIds } from "../../../shared/nvm/workbench/viewIds";
import { NvmBlockInfo } from "../../../shared/protocol";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { askNvm } from "../ai/openChat";
import { WorkbenchHost } from "./workbenchHost";

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

/** Context object VS Code passes from a row's `data-vscode-context`. */
interface RowContext {
	nvmBlockId?: string;
	nvmOffset?: number;
}

const VIEW_PICKS: { id: string; label: string }[] = [
	{ id: WorkbenchViewIds.blocksTable, label: "$(table) Blocks table" },
	{ id: WorkbenchViewIds.hex, label: "$(file-binary) Hex" },
	{ id: WorkbenchViewIds.inspector, label: "$(inspect) Inspector" },
	{ id: WorkbenchViewIds.overview, label: "$(dashboard) Overview" },
	{ id: WorkbenchViewIds.blocksTree, label: "$(list-tree) Tree" },
	{ id: WorkbenchViewIds.annotations, label: "$(bookmark) Annotations" },
	{ id: WorkbenchViewIds.customView, label: "$(preview) Custom view" },
];

export function blockQuestion(block: NvmBlockInfo): string {
	return `Explain the block "${block.name ?? block.id}" at ${hex(block.offset)} (${block.length} bytes): what does it contain, and does anything look abnormal?`;
}

export function registerWorkbenchCommands(
	registry: HexEditorRegistry,
	workbench: WorkbenchHost,
): vscode.Disposable[] {
	const activeBlocks = (): NvmBlockInfo[] =>
		registry.activeDocument ? (registry.getNvmBlocks(registry.activeDocument) as NvmBlockInfo[]) : [];

	return [
		vscode.commands.registerCommand("nvmStudio.nvm.askAboutBlock", async (ctx?: RowContext) => {
			const blocks = activeBlocks();
			const block =
				blocks.find(b => b.id === ctx?.nvmBlockId) ??
				blocks.find(b => b.offset === ctx?.nvmOffset);
			await askNvm(block ? blockQuestion(block) : "What can you tell me about this dump?");
		}),

		vscode.commands.registerCommand("nvmStudio.nvm.askAboutSelection", async () => {
			const doc = registry.activeDocument;
			const focus = doc ? registry.getNvmFocus(doc) : undefined;
			if (focus?.blockName) {
				const field = focus.fieldName ? ` (field "${focus.fieldName}")` : "";
				await askNvm(
					`What is at offset ${hex(focus.offset)} in block "${focus.blockName}"${field}? Explain its meaning and whether the value looks plausible.`,
				);
				return;
			}
			const offset = focus?.offset ?? doc?.selectionState.focused;
			await askNvm(
				offset !== undefined
					? `What is at offset ${hex(offset)} in this dump? Which block (if any) owns it and what does it mean?`
					: "Give me an overview of this dump. What should I look at first?",
			);
		}),

		vscode.commands.registerCommand("nvmStudio.workbench.selectLayout", async () => {
			const picks = workbench.presets().map(p => ({ label: p.layout.name, description: p.source, id: p.layout.id }));
			const pick = await vscode.window.showQuickPick(picks, { title: vscode.l10n.t("Workbench layout") });
			if (pick && !workbench.sendCommand({ kind: "selectPreset", presetId: pick.id })) {
				void vscode.window.showInformationMessage(vscode.l10n.t("Open an NVM dump first."));
			}
		}),

		vscode.commands.registerCommand("nvmStudio.workbench.exportLayout", () => exportLayout(registry, workbench)),

		vscode.commands.registerCommand("nvmStudio.workbench.resetLayout", () => {
			workbench.sendCommand({ kind: "resetLayout" });
		}),

		vscode.commands.registerCommand("nvmStudio.workbench.showView", async (viewId?: string) => {
			const id =
				typeof viewId === "string"
					? viewId
					: (await vscode.window.showQuickPick(VIEW_PICKS, { title: vscode.l10n.t("Open workbench view") }))?.id;
			if (id) {
				workbench.sendCommand({ kind: "showView", view: id });
			}
		}),
	];
}

/**
 * Export a preset (with the user's changes) as a `*.nvmworkbench.json` scene
 * file — by default next to the dump, where colleagues' NVM Studio finds it.
 */
async function exportLayout(registry: HexEditorRegistry, workbench: WorkbenchHost): Promise<void> {
	const pick = await vscode.window.showQuickPick(
		workbench.presets().map(p => ({ label: p.layout.name, description: p.source, preset: p })),
		{ title: vscode.l10n.t("Export which layout?") },
	);
	if (!pick) {
		return;
	}
	const layout = workbench.effectiveLayout(pick.preset);
	const slug = layout.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "layout";
	const dumpDir = registry.activeDocument ? vscode.Uri.joinPath(registry.activeDocument.uri, "..") : undefined;
	const target = await vscode.window.showSaveDialog({
		defaultUri: dumpDir ? vscode.Uri.joinPath(dumpDir, `${slug}.nvmworkbench.json`) : undefined,
		filters: { "NVM workbench layout": ["json"] },
	});
	if (!target) {
		return;
	}
	const file = { version: 1, id: slug, name: layout.name, requires: layout.requires, when: layout.when, root: layout.root };
	await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`));
	void vscode.window.showInformationMessage(
		vscode.l10n.t("Layout exported. Dumps in this folder (and ./conf) now offer it as a scenario layout."),
	);
}
