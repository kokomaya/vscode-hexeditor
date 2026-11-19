// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Commands around the workbench: pick / reset a layout, open a view, and the
 * "Ask @nvm about this" entry points (table/tree row and hex context menus).
 * Questions are pre-filled in the chat input, never sent automatically.
 */

import * as vscode from "vscode";
import { BUILTIN_LAYOUTS } from "../../../shared/nvm/workbench/builtinLayouts";
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
			const picks = BUILTIN_LAYOUTS.map(l => ({ label: l.name, id: l.id }));
			const pick = await vscode.window.showQuickPick(picks, { title: vscode.l10n.t("Workbench layout") });
			if (pick && !workbench.sendCommand({ kind: "selectPreset", presetId: pick.id })) {
				void vscode.window.showInformationMessage(vscode.l10n.t("Open an NVM dump first."));
			}
		}),

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
