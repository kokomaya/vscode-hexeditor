// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * User on/off switch per skill (`nvmstudio.nvm.skills.disabled`, by name).
 * Skills are active by default; an inactive one gets `enabled: false` in the
 * index (skillRegistry.getIndex), which every consumer — AI catalog, useSkill,
 * block bindings, checks, fallback decode, scene layouts — already honours.
 */

import * as vscode from "vscode";

const KEY = "nvm.skills.disabled";

export function disabledSkillNames(): Set<string> {
	return new Set(vscode.workspace.getConfiguration("nvmstudio").get<string[]>(KEY, []) ?? []);
}

/** Turn skills on / off (workspace setting when a folder is open, else user). */
export async function setSkillsEnabled(names: readonly string[], enabled: boolean): Promise<void> {
	const off = disabledSkillNames();
	for (const n of names) {
		if (enabled) {
			off.delete(n);
		} else {
			off.add(n);
		}
	}
	const target = vscode.workspace.workspaceFolders?.length
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	await vscode.workspace
		.getConfiguration("nvmstudio")
		.update(KEY, off.size ? [...off].sort() : undefined, target);
}
