// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Asks for the install server's address (engines, layout configs, skills all
 * come from the same server) and remembers the last one, so the next install
 * is a single Enter. A bare IP or host name is enough ("10.1.2.3" →
 * "http://10.1.2.3:7788").
 */

import * as vscode from "vscode";
import { DEFAULT_SERVER_PORT, normalizeServerBase } from "../../../shared/nvm/install/serverAddress";

const LAST_SERVER_KEY = "nvmStudio.installServer.lastBaseUrl";
const DEFAULT_SERVER = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

/** The server address used last (for UIs that show it without prompting). */
export const lastServerBase = (context: vscode.ExtensionContext): string | undefined =>
	context.globalState.get<string>(LAST_SERVER_KEY);

export const rememberServerBase = (context: vscode.ExtensionContext, base: string): Thenable<void> =>
	context.globalState.update(LAST_SERVER_KEY, base);

export async function promptServerBase(
	context: vscode.ExtensionContext,
	title: string,
	prompt: string,
): Promise<string | undefined> {
	const input = await vscode.window.showInputBox({
		title,
		prompt: `${prompt} — ${vscode.l10n.t("an IP / host name is enough (port {0} by default)", DEFAULT_SERVER_PORT)}`,
		value: context.globalState.get<string>(LAST_SERVER_KEY) ?? DEFAULT_SERVER,
		placeHolder: "10.1.2.3  |  nvm-server:8080  |  https://nvm.example.com",
		ignoreFocusOut: true,
		validateInput: v => (normalizeServerBase(v) ? undefined : vscode.l10n.t("Enter an IP, host name or http(s) URL")),
	});
	const base = input === undefined ? undefined : normalizeServerBase(input);
	if (base) {
		await context.globalState.update(LAST_SERVER_KEY, base);
	}
	return base;
}
