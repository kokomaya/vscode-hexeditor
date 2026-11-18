// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * "Skills" view in the NVM Studio container (skills.md §10): skills grouped by
 * kind; block skills expand to the blocks they bind in the active dump (click
 * to reveal); skills with problems carry a warning icon.
 */

import * as vscode from "vscode";
import { NvmBlockInfo } from "../../../shared/protocol";
import { SkillDiagnostic, SkillMeta } from "../../../shared/nvm/skills/types";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { SkillRegistry } from "./skillRegistry";

const MAX_CHILD_BLOCKS = 200;

export type SkillNode =
	| { type: "group"; kind: "playbook" | "block"; skills: SkillMeta[] }
	| { type: "skill"; meta: SkillMeta; bound?: number[]; problems: SkillDiagnostic[] }
	| { type: "block"; block: NvmBlockInfo }
	| { type: "info"; label: string };

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillNode> {
	private readonly emitter = new vscode.EventEmitter<SkillNode | undefined>();
	public readonly onDidChangeTreeData = this.emitter.event;

	constructor(
		private readonly skills: SkillRegistry,
		private readonly registry: HexEditorRegistry,
	) {}

	public refresh(): void {
		this.emitter.fire(undefined);
	}

	private blocks(): NvmBlockInfo[] {
		const doc = this.registry.activeDocument;
		return doc ? (this.registry.getNvmBlocks(doc) as NvmBlockInfo[]) : [];
	}

	public async getChildren(node?: SkillNode): Promise<SkillNode[]> {
		if (!node) {
			return this.roots();
		}
		if (node.type === "group") {
			return this.skillNodes(node.skills);
		}
		if (node.type === "skill" && node.bound) {
			const blocks = this.blocks();
			const kids: SkillNode[] = node.bound.slice(0, MAX_CHILD_BLOCKS).map(i => ({ type: "block", block: blocks[i] }));
			if (node.bound.length > MAX_CHILD_BLOCKS) {
				kids.push({ type: "info", label: `… ${node.bound.length - MAX_CHILD_BLOCKS} more` });
			}
			return kids;
		}
		return [];
	}

	private async roots(): Promise<SkillNode[]> {
		const index = await this.skills.getIndex(this.registry.activeDocument?.uri.fsPath);
		if (!index.skills.length) {
			return [{ type: "info", label: "No skills yet — run “NVM: New Skill…”" }];
		}
		const out: SkillNode[] = [];
		for (const kind of ["playbook", "block"] as const) {
			const list = index.skills.filter(s => s.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
			if (list.length) {
				out.push({ type: "group", kind, skills: list });
			}
		}
		if (index.restricted) {
			out.push({ type: "info", label: "Untrusted workspace: project skills hidden" });
		}
		return out;
	}

	private async skillNodes(list: SkillMeta[]): Promise<SkillNode[]> {
		const doc = this.registry.activeDocument;
		const index = await this.skills.getIndex(doc?.uri.fsPath);
		const blocks = this.blocks();
		const bindings = blocks.length
			? this.skills.bindings(blocks, index.skills, this.skills.layoutContext(doc?.uri))
			: undefined;
		return list.map(meta => ({
			type: "skill" as const,
			meta,
			bound: meta.kind === "block" ? bindings?.get(meta.name) : undefined,
			problems: index.diagnostics.filter(d => d.skill === meta.name && d.severity !== "info"),
		}));
	}

	public getTreeItem(node: SkillNode): vscode.TreeItem {
		switch (node.type) {
			case "group": {
				const item = new vscode.TreeItem(
					node.kind === "playbook" ? "Playbooks" : "Block knowledge",
					vscode.TreeItemCollapsibleState.Expanded,
				);
				item.description = String(node.skills.length);
				item.iconPath = new vscode.ThemeIcon(node.kind === "playbook" ? "book" : "symbol-structure");
				return item;
			}
			case "skill": {
				const n = node.bound?.length;
				const item = new vscode.TreeItem(
					node.meta.name,
					n ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
				);
				const tags = [
					node.meta.kind === "block" && n !== undefined ? `${n} block(s)` : "",
					node.meta.uses.length ? `uses ${node.meta.uses.length}` : "",
					node.meta.rules.length + node.meta.relations.length ? `${node.meta.rules.length + node.meta.relations.length} check(s)` : "",
					node.meta.scope,
				].filter(Boolean);
				item.description = tags.join(" · ");
				const md = new vscode.MarkdownString(`**${node.meta.name}** (${node.meta.kind}, ${node.meta.scope})\n\n${node.meta.description}`);
				if (node.problems.length) {
					md.appendMarkdown(`\n\n---\n${node.problems.map(p => `- ⚠ ${p.message}`).join("\n")}`);
				}
				item.tooltip = md;
				item.iconPath = new vscode.ThemeIcon(
					node.problems.length ? "warning" : node.meta.enabled ? (node.meta.kind === "playbook" ? "book" : "symbol-field") : "circle-slash",
				);
				item.contextValue = "nvmSkill";
				item.command = { command: "nvmStudio.nvm.skills.open", title: "Open Skill", arguments: [node] };
				return item;
			}
			case "block": {
				const b = node.block;
				const item = new vscode.TreeItem(b?.name ?? b?.id ?? "?", vscode.TreeItemCollapsibleState.None);
				item.description = b ? `0x${b.offset.toString(16).toUpperCase()}${b.sequence !== undefined ? ` · seq ${b.sequence}` : ""}` : "";
				item.iconPath = new vscode.ThemeIcon("symbol-variable");
				if (b) {
					item.command = { command: "nvmStudio.nvm.jumpTo", title: "Reveal", arguments: [b.offset] };
				}
				return item;
			}
			case "info":
				return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
		}
	}
}
