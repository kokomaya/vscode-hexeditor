// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Skill commands + view registration: New Skill…, Reload Skills, Show Skill
 * Diagnostics, Check Skill Rules, Open Skill, and the Skills tree.
 */

import * as vscode from "vscode";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { formatCheck } from "../ai/lmSkillTools";
import { SkillCapabilities } from "../ai/skillCapabilities";
import { getNvmLog } from "../nvmLog";
import { nvmStudioSkillsUri } from "../paths";
import { SkillRegistry } from "./skillRegistry";
import { SkillNode, SkillsTreeProvider } from "./skillsTree";
import { setSkillsEnabled } from "./skillToggle";
import { blockTemplate, playbookTemplate, structTemplate } from "./skillTemplates";

const enc = new TextEncoder();

async function pickTargetRoot(): Promise<vscode.Uri | undefined> {
	const items: (vscode.QuickPickItem & { uri?: vscode.Uri })[] = [
		{ label: "$(home) User skills", description: nvmStudioSkillsUri().fsPath, uri: nvmStudioSkillsUri() },
	];
	for (const f of vscode.workspace.workspaceFolders ?? []) {
		const uri = vscode.Uri.joinPath(f.uri, ".nvmstudio", "skills");
		items.push({ label: `$(repo) Workspace: ${f.name}`, description: uri.fsPath, uri });
	}
	items.push({ label: "$(folder) Choose folder…" });
	const pick = await vscode.window.showQuickPick(items, { title: "Where should the skill live?" });
	if (!pick) {
		return undefined;
	}
	if (pick.uri) {
		return pick.uri;
	}
	const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use as skill root" });
	return chosen?.[0];
}

async function newSkill(): Promise<void> {
	const kind = await vscode.window.showQuickPick(
		[
			{ label: "playbook", description: "How to investigate a kind of question (tool order, answer format, composition)" },
			{ label: "block", description: "What a block is: match rules, field meanings, struct, rules & relations" },
		],
		{ title: "Skill kind" },
	);
	if (!kind) {
		return;
	}
	const name = await vscode.window.showInputBox({
		title: "Skill name",
		prompt: "lowercase letters, digits and '-' (e.g. my-counter)",
		validateInput: v => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : "use [a-z0-9-], starting with a letter or digit"),
	});
	if (!name) {
		return;
	}
	const root = await pickTargetRoot();
	if (!root) {
		return;
	}
	const dir = vscode.Uri.joinPath(root, name);
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, "SKILL.md"));
		void vscode.window.showWarningMessage(`Skill "${name}" already exists at ${dir.fsPath}.`);
		return;
	} catch {
		// does not exist — good
	}
	await vscode.workspace.fs.createDirectory(dir);
	const file = vscode.Uri.joinPath(dir, "SKILL.md");
	await vscode.workspace.fs.writeFile(file, enc.encode(kind.label === "block" ? blockTemplate(name) : playbookTemplate(name)));
	if (kind.label === "block") {
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `${name}.struct.json`), enc.encode(structTemplate()));
	}
	await vscode.window.showTextDocument(file);
}

/** Register the Skills view and commands. */
export function registerSkillCommands(
	skills: SkillRegistry,
	registry: HexEditorRegistry,
	caps: SkillCapabilities,
): vscode.Disposable[] {
	const tree = new SkillsTreeProvider(skills, registry);
	const view = vscode.window.createTreeView("nvmStudio.skills", {
		treeDataProvider: tree,
		showCollapseAll: true,
		manageCheckboxStateManually: true,
	});
	const log = getNvmLog();

	return [
		view,
		view.onDidChangeCheckboxState(e => {
			const on = e.items.filter(([n, s]) => n.type === "skill" && s === vscode.TreeItemCheckboxState.Checked);
			const off = e.items.filter(([n, s]) => n.type === "skill" && s === vscode.TreeItemCheckboxState.Unchecked);
			const names = (list: typeof on) => list.map(([n]) => (n.type === "skill" ? n.meta.name : ""));
			void (async () => {
				if (on.length) {
					await setSkillsEnabled(names(on), true);
				}
				if (off.length) {
					await setSkillsEnabled(names(off), false);
				}
			})();
		}),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.activate", (node?: SkillNode) =>
			node?.type === "skill" ? setSkillsEnabled([node.meta.name], true) : undefined,
		),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.deactivate", (node?: SkillNode) =>
			node?.type === "skill" ? setSkillsEnabled([node.meta.name], false) : undefined,
		),
		skills.onDidChange(() => tree.refresh()),
		registry.onDidChangeActiveDocument(() => tree.refresh()),
		registry.onDidChangeNvmBlocks(() => tree.refresh()),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.new", () => newSkill()),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.reload", () => {
			skills.reload();
			void vscode.window.setStatusBarMessage("NVM skills reloaded.", 2000);
		}),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.open", async (node?: SkillNode) => {
			if (node?.type === "skill") {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.Uri.parse(node.meta.dir), "SKILL.md"));
			}
		}),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.diagnostics", async () => {
			const index = await skills.getIndex(registry.activeDocument?.uri.fsPath);
			log.info(`Skill diagnostics — ${index.skills.length} skill(s)${index.restricted ? " (untrusted workspace: project skills skipped)" : ""}`);
			for (const s of index.skills) {
				log.info(`  ${s.name} [${s.kind}, ${s.scope}] ${s.dir}`);
			}
			for (const d of index.diagnostics) {
				const line = `  ${d.skill ?? "?"}: ${d.message}${d.location ? ` (${d.location})` : ""}`;
				if (d.severity === "error") {
					log.error(line);
				} else if (d.severity === "warning") {
					log.warn(line);
				} else {
					log.info(line);
				}
			}
			// Block skills that bind nothing in the active dump are worth knowing about.
			const doc = registry.activeDocument;
			const blocks = doc ? registry.getNvmBlocks(doc) : [];
			if (blocks.length) {
				const b = skills.bindings(blocks, index.skills, skills.layoutContext(doc?.uri));
				for (const [name, hits] of b) {
					if (!hits.length) {
						log.warn(`  ${name}: block skill matches no block in the active dump`);
					}
				}
			}
			log.show(true);
		}),
		vscode.commands.registerCommand("nvmStudio.nvm.skills.checkRules", async () => {
			try {
				const r = await caps.checkRules({ includePass: true });
				log.info(`Skill rule check:\n${formatCheck(r)}`);
				log.show(true);
				void vscode.window.showInformationMessage(
					`NVM skill checks: ${r.counts.fail} failed, ${r.counts.error} not evaluable, ${r.counts.pass} passed (details in the NVM Studio log).`,
				);
			} catch (e) {
				void vscode.window.showWarningMessage(e instanceof Error ? e.message : String(e));
			}
		}),
	];
}
