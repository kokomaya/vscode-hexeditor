// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * "Dump & Config" sidebar view: how the active dump is parsed (status,
 * profile, descriptors, source files, engine gate, editor layout), each node
 * clickable to fix it. Also registers the small commands it relies on.
 */

import * as vscode from "vscode";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { askNvm } from "../ai/openChat";
import { getNvmLog } from "../nvmLog";
import { buildConfigNodes, ConfigNode, NodeState } from "./dumpConfigModel";
import { LoadDiagnosticsStore } from "./loadDiagnostics";

export const DUMP_CONFIG_VIEW_ID = "nvmStudio.dumpConfig";

const STATE_ICONS: Record<NodeState, vscode.ThemeIcon> = {
	ok: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
	warning: new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
	error: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
	info: new vscode.ThemeIcon("info"),
	loading: new vscode.ThemeIcon("loading~spin"),
};

class DumpConfigProvider implements vscode.TreeDataProvider<ConfigNode> {
	private readonly emitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this.emitter.event;

	constructor(
		private readonly registry: HexEditorRegistry,
		private readonly diagnostics: LoadDiagnosticsStore,
	) {}

	public refresh(): void {
		this.emitter.fire();
	}

	public getChildren(node?: ConfigNode): ConfigNode[] {
		if (node) {
			return node.children ?? [];
		}
		const doc = this.registry.activeDocument;
		const diagnosis = doc && this.diagnostics.get(doc.uri);
		if (!diagnosis) {
			return []; // the viewsWelcome content explains what to do
		}
		const config = vscode.workspace.getConfiguration("nvmstudio");
		return buildConfigNodes(diagnosis, {
			layoutMode: config.get<string>("nvm.layoutMode", "workbench") === "classic" ? "classic" : "workbench",
			enginesAllowed: config.get<boolean>("nvm.allowExternalEngines", true),
			workspaceTrusted: vscode.workspace.isTrusted,
		});
	}

	public getTreeItem(node: ConfigNode): vscode.TreeItem {
		const item = new vscode.TreeItem(
			node.label,
			node.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
		);
		item.id = node.id;
		item.description = node.description;
		item.tooltip = node.tooltip;
		item.iconPath = node.icon && node.state === "info" ? new vscode.ThemeIcon(node.icon) : STATE_ICONS[node.state];
		if (node.command) {
			item.command = { command: node.command.id, title: node.label, arguments: node.command.args };
		}
		return item;
	}
}

export function registerDumpConfigView(
	registry: HexEditorRegistry,
	diagnostics: LoadDiagnosticsStore,
): vscode.Disposable[] {
	const provider = new DumpConfigProvider(registry, diagnostics);
	return [
		vscode.window.registerTreeDataProvider(DUMP_CONFIG_VIEW_ID, provider),
		registry.onDidChangeActiveDocument(() => provider.refresh()),
		diagnostics.onDidChange(() => provider.refresh()),
		vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration("nvmstudio.nvm") && provider.refresh()),
		vscode.workspace.onDidGrantWorkspaceTrust(() => provider.refresh()),
		vscode.commands.registerCommand("nvmStudio.nvm.showLog", () => getNvmLog().show(true)),
		vscode.commands.registerCommand("nvmStudio.nvm.explainLoad", () => askNvm("/why")),
	];
}
