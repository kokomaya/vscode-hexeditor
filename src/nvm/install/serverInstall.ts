// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * "NVM: Install from Server…": enter the server's IP / URL, pick the product /
 * platform / project you work on (or everything), and get exactly what it
 * needs — the engine(s) its binding names, its layout descriptors, and the
 * skills visible in it. The chosen project then becomes the skill context.
 *
 * Engines are code, so they stay behind one explicit modal; descriptors and
 * skills are data.
 */

import * as vscode from "vscode";
import { InstallPlan, planInstall } from "../../../shared/nvm/install/installPlan";
import { formatHierarchyPath } from "../../../shared/nvm/skills/hierarchy";
import { installConfigs } from "../discovery/configInstall";
import { promptServerBase } from "../discovery/installServer";
import { SECURITY_NOTE } from "../engines/engineCommands";
import { EngineManager } from "../engines/engineManager";
import { configuredSkillContext, writeSkillContext } from "../skills/skillContextCommand";
import { describeSkillInstall, installSkills } from "../skills/skillInstall";
import { pickInstallTarget } from "./installTargetPick";
import { fetchCatalog } from "./serverCatalog";

export const INSTALL_FROM_SERVER_COMMAND = "nvmStudio.nvm.installVendorPackFromUrl";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Engines + descriptors behind one cancellable progress notification. */
function installEnginesAndConfigs(base: string, plan: InstallPlan, manager: EngineManager): Thenable<string[]> {
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Installing from NVM server"), cancellable: true },
		async (progress, token) => {
			const summary: string[] = [];
			const engines: string[] = [];
			for (const engine of plan.engines) {
				if (token.isCancellationRequested) {
					return [...summary, vscode.l10n.t("cancelled")];
				}
				progress.report({ message: `engine ${engine.id}` });
				try {
					await manager.installFromServer(base, engine);
					engines.push(engine.version ? `${engine.id}@${engine.version}` : engine.id);
				} catch (e) {
					summary.push(`engine ${engine.id} failed: ${errorText(e)}`);
				}
			}
			if (plan.engines.length) {
				summary.unshift(`${engines.length} engine(s)${engines.length ? `: ${engines.join(", ")}` : ""}`);
			}
			if (plan.configs.length && !token.isCancellationRequested) {
				progress.report({ message: vscode.l10n.t("layout configs") });
				try {
					const { installed, confDir } = await installConfigs(base, plan.configs);
					summary.push(`${installed} layout config(s) → ${confDir.fsPath}`);
				} catch (e) {
					summary.push(`layout configs failed: ${errorText(e)}`);
				}
			}
			return summary;
		},
	);
}

/**
 * Install `plan` (engines behind one modal, then descriptors, then skills).
 * Returns summary lines, or undefined when the engine confirmation was declined.
 */
export async function runInstallPlan(base: string, plan: InstallPlan, manager: EngineManager): Promise<string[] | undefined> {
	if (!(await confirmEngines(base, plan))) {
		return undefined;
	}
	const lines = await installEnginesAndConfigs(base, plan, manager);
	if (plan.skills.length) {
		lines.push(describeSkillInstall(await installSkills(base, plan.skills)));
	}
	return lines;
}

async function confirmEngines(base: string, plan: InstallPlan): Promise<boolean> {
	if (!plan.engines.length) {
		return true;
	}
	const list = plan.engines.map(e => `• ${e.id}${e.version ? `@${e.version}` : ""} — ${e.displayName}`).join("\n");
	const ok = await vscode.window.showWarningMessage(
		`${SECURITY_NOTE}\n\nInstall from ${base}:\n${list}`,
		{ modal: true },
		vscode.l10n.t("Install"),
	);
	return ok === vscode.l10n.t("Install");
}

async function report(lines: string[], plan: InstallPlan, context: string): Promise<void> {
	if (plan.missing.length) {
		lines.push(`not on the server: ${plan.missing.join(", ")}`);
	}
	const enginesAllowed = vscode.workspace.getConfiguration("nvmstudio.nvm").get<boolean>("allowExternalEngines", false);
	const openSetting = vscode.l10n.t("Allow external engines…");
	const actions = plan.engines.length && !enginesAllowed ? [openSetting] : [];
	const show = plan.missing.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
	const head = context ? `Installed for ${context} (now the skill context)` : "Installed";
	const action = await show(`${head}:\n- ${lines.join("\n- ")}`, ...actions);
	if (action === openSetting) {
		await vscode.commands.executeCommand("workbench.action.openSettings", "nvmstudio.nvm.allowExternalEngines");
	}
}

export function registerServerInstallCommand(context: vscode.ExtensionContext, manager: EngineManager): vscode.Disposable {
	return vscode.commands.registerCommand(INSTALL_FROM_SERVER_COMMAND, async () => {
		const base = await promptServerBase(
			context,
			vscode.l10n.t("Install from NVM server"),
			vscode.l10n.t("Server address"),
		);
		if (!base) {
			return;
		}
		const { catalog, errors } = await fetchCatalog(base);
		if (errors.length === 3) {
			void vscode.window.showErrorMessage(`Cannot reach the NVM server at ${base}:\n${errors.join("\n")}`);
			return;
		}
		const choice = await pickInstallTarget(catalog, configuredSkillContext());
		if (!choice) {
			return;
		}
		const target = choice === "all" ? undefined : choice;
		const plan = planInstall(catalog, target);
		if (!plan.engines.length && !plan.configs.length && !plan.skills.length) {
			void vscode.window.showInformationMessage(
				`Nothing to install${plan.missing.length ? ` (not on the server: ${plan.missing.join(", ")})` : ""}.`,
			);
			return;
		}
		const installed = await runInstallPlan(base, plan, manager);
		if (!installed) {
			return;
		}
		const lines = [...errors.map(e => `listing ${e}`), ...installed];
		const contextKey = target ? formatHierarchyPath(target) : "";
		if (target) {
			await writeSkillContext(contextKey);
		}
		await report(lines, plan, contextKey);
	});
}
