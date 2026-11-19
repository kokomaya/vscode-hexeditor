// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Newcomer entry points: open the bundled synthetic sample dump (practise
 * without project data) and open the "Get started" walkthrough.
 */

import * as vscode from "vscode";

const EDITOR_VIEW_TYPE = "nvmStudio.hexedit";
const WALKTHROUGH_ID = "nvmStudio.gettingStarted";
const SAMPLE_PATH = ["samples", "basic-log", "sample-nvm.mot"];

export function registerOnboardingCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
	const extensionId = `${context.extension.packageJSON.publisher}.${context.extension.packageJSON.name}`;
	return [
		vscode.commands.registerCommand("nvmStudio.nvm.openSample", async () => {
			const uri = vscode.Uri.joinPath(context.extensionUri, ...SAMPLE_PATH);
			await vscode.commands.executeCommand("vscode.openWith", uri, EDITOR_VIEW_TYPE);
		}),
		vscode.commands.registerCommand("nvmStudio.nvm.openWalkthrough", async () => {
			await vscode.commands.executeCommand(
				"workbench.action.openWalkthrough",
				`${extensionId}#${WALKTHROUGH_ID}`,
				false,
			);
		}),
	];
}
