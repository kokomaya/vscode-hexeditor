// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Skill search roots (skills.md §5.1), highest priority first:
 *
 * 1. `nvmstudio.nvm.skillRoots` (each dir and its `skills/` subdir)   — setting
 * 2. next to layout descriptors: `<dump>/skills`, `<dump>/conf/skills`,
 *    `<dump>/../conf/skills`, `<layoutRoot>/skills`, `<layoutRoot>/conf/skills` — descriptor
 * 3. `<workspaceFolder>/.nvmstudio/skills`                             — workspace
 * 4. `<NVMSTUDIO_HOME>/skills` (default `~/nvmstudio/skills`)          — user
 * 5. `<extension>/skills` (generic, vendor-free playbooks)            — builtin
 *
 * Workspace-controlled roots (1–3) are only used in a trusted workspace,
 * because skill bodies are injected into the AI prompt.
 */

import * as vscode from "vscode";
import { SkillScope } from "../../../shared/nvm/skills/types";
import { configuredLayoutRoots, expandWorkspaceVars } from "../discovery/fileIndex";
import { nvmStudioSkillsUri } from "../paths";

export interface SkillRoot {
	uri: vscode.Uri;
	scope: SkillScope;
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]+$/, "");

/** Roots that do not depend on the opened dump. */
export function globalSkillRoots(extensionUri: vscode.Uri): SkillRoot[] {
	const roots: SkillRoot[] = [];
	if (vscode.workspace.isTrusted) {
		const configured =
			vscode.workspace.getConfiguration("nvmstudio").get<string[]>("nvm.skillRoots", []) ?? [];
		for (const raw of configured) {
			const p = raw ? expandWorkspaceVars(raw) : "";
			if (p) {
				roots.push({ uri: vscode.Uri.file(p), scope: "setting" });
				roots.push({ uri: vscode.Uri.file(`${p}/skills`), scope: "setting" });
			}
		}
		for (const f of vscode.workspace.workspaceFolders ?? []) {
			roots.push({ uri: vscode.Uri.joinPath(f.uri, ".nvmstudio", "skills"), scope: "workspace" });
		}
	}
	roots.push({ uri: nvmStudioSkillsUri(), scope: "user" });
	roots.push({ uri: vscode.Uri.joinPath(extensionUri, "skills"), scope: "builtin" });
	return roots;
}

/** Descriptor-adjacent roots for a dump file (empty when untrusted / no file path). */
export function descriptorSkillRoots(dumpFsPath: string | undefined): SkillRoot[] {
	if (!dumpFsPath || !vscode.workspace.isTrusted) {
		return [];
	}
	const dir = dirOf(dumpFsPath);
	const parent = dirOf(dir);
	const dirs = [`${dir}/skills`, `${dir}/conf/skills`, `${parent}/conf/skills`];
	for (const r of configuredLayoutRoots()) {
		dirs.push(`${r}/skills`, `${r}/conf/skills`);
	}
	return [...new Set(dirs)].map(d => ({ uri: vscode.Uri.file(d), scope: "descriptor" as const }));
}
