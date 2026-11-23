// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Quick pick: "which product / platform / project do you work on?" — or
 * everything on the server. Each row shows what its binding would install.
 */

import * as vscode from "vscode";
import { formatHierarchyPath } from "../../../shared/nvm/skills/hierarchy";
import { InstallTarget, installTargets, ServerCatalog } from "../../../shared/nvm/install/installPlan";

/** `undefined` = cancelled, `"all"` = everything, else the chosen context. */
export type TargetChoice = undefined | "all" | string[];

type Item = vscode.QuickPickItem & { choice?: TargetChoice };

function describe(t: InstallTarget, current: string): string {
	const parts: string[] = [t.level];
	if (t.binding.engines.length) {
		parts.push(`engine ${t.binding.engines.join(", ")}`);
	}
	if (t.binding.configs.length) {
		parts.push(`${t.binding.configs.length} conf`);
	}
	parts.push(`${t.skills} skill(s)`);
	if (formatHierarchyPath(t.context) === current) {
		parts.push(vscode.l10n.t("current"));
	}
	return parts.join(" · ");
}

export async function pickInstallTarget(catalog: ServerCatalog, current: string): Promise<TargetChoice> {
	const targets = installTargets(catalog);
	const totals = `${catalog.engines.engines.length} engine(s) · ${catalog.configs.length} conf · ${catalog.skills.skills.length} skill(s)`;
	const items: Item[] = targets.map(t => ({
		label: `${"    ".repeat(t.context.length - 1)}${t.title.split(" › ").pop()}`,
		description: describe(t, current),
		detail: [formatHierarchyPath(t.context), t.description].filter(Boolean).join(" — "),
		choice: t.context,
	}));
	// The current context first, so Enter re-installs / updates it.
	const currentIndex = items.findIndex(i => Array.isArray(i.choice) && formatHierarchyPath(i.choice) === current);
	const ordered: Item[] = [
		...(currentIndex >= 0 ? [items[currentIndex]] : []),
		{ label: vscode.l10n.t("Everything on the server"), description: totals, choice: "all" },
		...(items.length ? [{ label: vscode.l10n.t("Products / platforms / projects"), kind: vscode.QuickPickItemKind.Separator }] : []),
		...items.filter((_, i) => i !== currentIndex),
	];
	const pick = await vscode.window.showQuickPick(ordered, {
		title: vscode.l10n.t("Install from NVM server — what do you work on?"),
		placeHolder: vscode.l10n.t("A project installs its engine, layout configs and skills, and becomes the skill context"),
		matchOnDescription: true,
		matchOnDetail: true,
		ignoreFocusOut: true,
	});
	return pick?.choice;
}
