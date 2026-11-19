// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Open the chat view with a starting query. `isPartialQuery: true` places the
 * text in the chat input WITHOUT auto-submitting it, so the user can edit the
 * prompt before sending (VS Code only calls `setInput`, not `acceptInput`).
 */

import * as vscode from "vscode";

const PARTICIPANT_PREFIX = "@nvm ";

/** Try to open the chat with `query`; returns false if no chat API is available. */
export async function tryOpenChat(query: string): Promise<boolean> {
	for (const cmd of ["workbench.action.chat.open", "workbench.action.chat.openInSidebar"]) {
		try {
			await vscode.commands.executeCommand(cmd, { query, isPartialQuery: true });
			return true;
		} catch {
			// try the next command id
		}
	}
	return false;
}

/** Open the chat with a pre-filled question addressed to the @nvm participant. */
export async function askNvm(question: string): Promise<void> {
	const text = question.trim();
	const query = text.startsWith("@") ? text : `${PARTICIPANT_PREFIX}${text}`;
	if (!(await tryOpenChat(query))) {
		void vscode.window.showInformationMessage(
			vscode.l10n.t("Chat is not available. Install/enable a chat extension to ask @nvm."),
		);
	}
}
