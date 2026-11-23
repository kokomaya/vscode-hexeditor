// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * "NVM: Select Skill Context…": pick the product / platform / project whose
 * skills apply — from the hierarchy folders present in the skill roots, the
 * levels the install server announced, recently used contexts and the current
 * one (see contextMemory.ts). Writes `nvmstudio.nvm.skills.context` (workspace
 * when one is open). A descriptor's `skillContext` still wins for the dumps it
 * parses.
 */

import * as vscode from "vscode";
import { formatHierarchyPath, levelOf } from "../../../shared/nvm/skills/hierarchy";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { contextCandidates, rememberContext } from "./contextMemory";
import { SkillRegistry } from "./skillRegistry";

export const SELECT_SKILL_CONTEXT_COMMAND = "nvmStudio.nvm.skills.selectContext";

export function registerSkillContextCommand(skills: SkillRegistry, registry: HexEditorRegistry): vscode.Disposable {
	return vscode.commands.registerCommand(SELECT_SKILL_CONTEXT_COMMAND, async () => {
		const index = await skills.getIndex(registry.activeDocument?.uri.fsPath);
		const current = formatHierarchyPath(index.context);
		const candidates = contextCandidates(index.contexts, index.context);
		if (!candidates.length) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t("No product / platform / project skill folders found. Install skills from a server or create folders like <product>/<platform>/<project>/<skill>/SKILL.md."),
			);
			return;
		}
		const items = [
			{ label: vscode.l10n.t("General skills only"), description: current === "" ? vscode.l10n.t("current") : "", value: "" },
			...candidates.map(c => ({
				label: `${"    ".repeat(c.path.length - 1)}${c.title.split(" › ").pop()}`,
				description: [
					levelOf(c.path),
					c.key === current ? vscode.l10n.t("current") : "",
					c.local ? "" : c.remote ? vscode.l10n.t("on server, no local skills at this level") : vscode.l10n.t("no local skills at this level"),
					c.recent && c.key !== current ? vscode.l10n.t("recent") : "",
				].filter(Boolean).join(" · "),
				detail: c.key,
				value: c.key,
			})),
		];
		const pick = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t("Select skill context (product / platform / project)"),
			placeHolder: vscode.l10n.t("Skills of the chosen folder and of its parents apply; nearer folders win on a name clash"),
			matchOnDetail: true,
		});
		if (pick) {
			await writeSkillContext(pick.value);
		}
	});
}

/** Set `nvmstudio.nvm.skills.context` (workspace when one is open, else user); "" clears it. */
export async function writeSkillContext(value: string): Promise<void> {
	const target = vscode.workspace.workspaceFolders?.length
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	rememberContext(value);
	await vscode.workspace.getConfiguration("nvmstudio").update("nvm.skills.context", value || undefined, target);
}

/** The configured skill context ("" = general only). */
export const configuredSkillContext = () =>
	vscode.workspace.getConfiguration("nvmstudio").get<string>("nvm.skills.context", "") ?? "";
