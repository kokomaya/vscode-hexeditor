// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Install skills from the install server into the user skill root, keeping the
 * server's product / platform / project folders
 * (`<NVMSTUDIO_HOME>/skills/<product>/<platform>/<project>/<name>/`). Runs in
 * the background behind a cancellable progress notification; each skill folder
 * is replaced as a whole so removed resources do not linger. Skills are data
 * (Markdown/JSON), so no code-execution gate applies — but they do reach the
 * AI prompt, hence the explicit pick list.
 */

import * as vscode from "vscode";
import { formatHierarchyPath, parseHierarchyPath, visibleIn } from "../../../shared/nvm/skills/hierarchy";
import { parseSkillListing, RemoteSkill, SkillListing, skillFileUrl } from "../../../shared/nvm/skills/remoteSkills";
import { promptServerBase } from "../discovery/installServer";
import { downloadFolder, fetchJson } from "../install/download";
import { nvmStudioSkillsUri } from "../paths";
import { rememberServerLevels, rememberSkillVersions } from "./contextMemory";
import { SELECT_SKILL_CONTEXT_COMMAND } from "./skillContextCommand";

export interface SkillInstallResult {
	installed: string[];
	failed: { name: string; error: string }[];
	dir: vscode.Uri;
}

export async function listRemoteSkills(base: string): Promise<SkillListing> {
	const listing = parseSkillListing(await fetchJson(`${base}/v1/skills`));
	rememberServerLevels(listing.levels, listing.skills);
	return listing;
}

/** Download every file first, then swap the folder in (no half-installed skill). */
function installOne(base: string, skill: RemoteSkill, root: vscode.Uri): Promise<void> {
	return downloadFolder(
		vscode.Uri.joinPath(root, ...skill.path, skill.name),
		skill.files.map(rel => ({ rel, url: skillFileUrl(base, skill.id, rel) })),
	);
}

/** Install `skills` with a background progress notification. */
export function installSkills(base: string, skills: readonly RemoteSkill[]): Thenable<SkillInstallResult> {
	const dir = nvmStudioSkillsUri();
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Installing NVM skills"), cancellable: true },
		async (progress, token) => {
			const result: SkillInstallResult = { installed: [], failed: [], dir };
			await vscode.workspace.fs.createDirectory(dir);
			for (const skill of skills) {
				if (token.isCancellationRequested) {
					break;
				}
				progress.report({ message: skill.id, increment: 100 / skills.length });
				try {
					await installOne(base, skill, dir);
					result.installed.push(skill.id);
					rememberSkillVersions([skill]);
				} catch (e) {
					result.failed.push({ name: skill.id, error: e instanceof Error ? e.message : String(e) });
				}
			}
			if (result.installed.length) {
				await vscode.commands.executeCommand("nvmStudio.nvm.skills.reload");
			}
			return result;
		},
	);
}

/** One-line outcome for a notification. */
export function describeSkillInstall(r: SkillInstallResult): string {
	const parts = [`${r.installed.length} skill(s) → ${r.dir.fsPath}`];
	if (r.failed.length) {
		parts.push(`${r.failed.length} failed (${r.failed.map(f => f.name).join(", ")})`);
	}
	return parts.join("; ");
}

type SkillPick = vscode.QuickPickItem & { skill?: RemoteSkill };

/** Pick list grouped by level folder; skills of the current context are pre-selected. */
async function pickSkills(listing: SkillListing): Promise<RemoteSkill[] | undefined> {
	const setting = vscode.workspace.getConfiguration("nvmstudio").get<string>("nvm.skills.context", "");
	const context = parseHierarchyPath(setting) ?? [];
	const titles = new Map(listing.levels.map(l => [formatHierarchyPath(l.path), l.title]));
	const groups = new Map<string, RemoteSkill[]>();
	for (const s of listing.skills) {
		const key = formatHierarchyPath(s.path);
		groups.set(key, [...(groups.get(key) ?? []), s]);
	}
	const items: SkillPick[] = [];
	for (const key of [...groups.keys()].sort()) {
		const path = key ? key.split("/") : [];
		const label = path.length ? path.map((p, i) => titles.get(formatHierarchyPath(path.slice(0, i + 1))) ?? p).join(" › ") : "General";
		items.push({ label, kind: vscode.QuickPickItemKind.Separator });
		for (const s of groups.get(key)!) {
			items.push({
				label: s.name,
				description: [s.level, s.kind, s.version && `v${s.version}`].filter(Boolean).join(" · "),
				detail: s.description,
				picked: context.length ? visibleIn(s.path, context) : true,
				skill: s,
			});
		}
	}
	const picks = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Install NVM skills"),
		placeHolder: vscode.l10n.t("Skills are added to the AI prompt when they match — install only ones you trust"),
		canPickMany: true,
		matchOnDescription: true,
		matchOnDetail: true,
	});
	return picks?.map(p => p.skill).filter((s): s is RemoteSkill => !!s);
}

export function registerSkillInstallCommand(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand("nvmStudio.nvm.installSkillsFromUrl", async () => {
		const base = await promptServerBase(
			context,
			vscode.l10n.t("Install NVM skills from server"),
			vscode.l10n.t("Server base URL (the /v1/skills endpoint is used)"),
		);
		if (!base) {
			return;
		}
		let listing: SkillListing;
		try {
			listing = await listRemoteSkills(base);
		} catch (e) {
			void vscode.window.showErrorMessage(`Install skills failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		if (!listing.skills.length) {
			void vscode.window.showInformationMessage(vscode.l10n.t("The server has no skills to install."));
			return;
		}
		const chosen = await pickSkills(listing);
		if (!chosen?.length) {
			return;
		}
		const result = await installSkills(base, chosen);
		const show = result.failed.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
		const needsContext =
			chosen.some(s => s.path.length) &&
			!vscode.workspace.getConfiguration("nvmstudio").get<string>("nvm.skills.context", "");
		const selectContext = vscode.l10n.t("Select skill context");
		const action = await show(
			`Installed ${describeSkillInstall(result)}${needsContext ? ". Product / platform / project skills apply once a skill context is selected." : ""}`,
			...(needsContext ? [selectContext] : []),
			vscode.l10n.t("Show skills"),
		);
		if (action === selectContext) {
			await vscode.commands.executeCommand(SELECT_SKILL_CONTEXT_COMMAND);
		} else if (action) {
			await vscode.commands.executeCommand("nvmStudio.skills.focus");
		}
	});
}
