// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Install layout descriptors (`*.nvmlayout.json`) from an install server into
 * the unified NVM Studio user home, keeping the server's folders
 * (`<home>/conf/radar/chipA/customerB/x.nvmlayout.json`), then register each
 * folder in `nvmstudio.nvm.layoutRoots` so descriptors are discovered without
 * copying them next to every dump.
 */

import * as vscode from "vscode";
import { configFileUrl, parseConfigListing, RemoteConfig } from "../../../shared/nvm/install/remoteConfigs";
import { fetchJson, fetchText, writeText } from "../install/download";
import { nvmStudioConfUri } from "../paths";
import { promptServerBase } from "./installServer";

/** Add a folder fsPath to `nvmstudio.nvm.layoutRoots` (global), avoiding dups. */
export async function ensureLayoutRoot(fsPath: string): Promise<void> {
	const config = vscode.workspace.getConfiguration("nvmstudio.nvm");
	const current = config.get<string[]>("layoutRoots", []) ?? [];
	const normalized = fsPath.replace(/\\/g, "/").toLowerCase();
	if (current.some(r => r.replace(/\\/g, "/").toLowerCase() === normalized)) {
		return;
	}
	await config.update("layoutRoots", [...current, fsPath], vscode.ConfigurationTarget.Global);
}

export async function listRemoteConfigs(base: string): Promise<RemoteConfig[]> {
	return parseConfigListing(await fetchJson(`${base}/v1/configs`));
}

/** Download `configs` into `<home>/conf/<path>` and register their folders as layout roots. */
export async function installConfigs(
	base: string,
	configs: readonly RemoteConfig[],
): Promise<{ installed: number; confDir: vscode.Uri }> {
	const confDir = nvmStudioConfUri();
	const folders = new Set<string>();
	let installed = 0;
	for (const config of configs) {
		const parts = config.path.split("/");
		const folder = vscode.Uri.joinPath(confDir, ...parts.slice(0, -1));
		await writeText(vscode.Uri.joinPath(folder, parts[parts.length - 1]), await fetchText(configFileUrl(base, config)));
		folders.add(folder.fsPath);
		installed++;
	}
	for (const folder of folders) {
		await ensureLayoutRoot(folder);
	}
	return { installed, confDir };
}

/** Register the "Install Layout Configs from URL" command (installs every descriptor the server has). */
export function registerConfigInstallCommand(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand("nvmStudio.nvm.installConfigsFromUrl", async () => {
		const base = await promptServerBase(
			context,
			"Install layout configs from server",
			"Server base URL (the /v1/configs endpoint is used)",
		);
		if (!base) {
			return;
		}

		try {
			const { installed, confDir } = await installConfigs(base, await listRemoteConfigs(base));
			if (installed === 0) {
				void vscode.window.showInformationMessage(
					"Server has no layout configs to install.",
				);
				return;
			}
			void vscode.window.showInformationMessage(
				`Installed ${installed} layout config(s) to:\n${confDir.fsPath}\nAdded to nvmstudio.nvm.layoutRoots.`,
			);
		} catch (e) {
			void vscode.window.showErrorMessage(
				`Install layout configs failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	});
}
