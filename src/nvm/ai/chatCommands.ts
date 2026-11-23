// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Newcomer-oriented `@nvm` slash commands:
 *  - `/help`    what I can do for this dump (deterministic, no model call);
 *  - `/why`     why the dump was / wasn't recognized (deterministic);
 *  - `/explain` explain the current selection (rewrites the prompt, then the
 *               normal tool-using answer runs).
 */

import * as vscode from "vscode";
import { ChatTextStream } from "./chatUi";
import { NvmCapabilities } from "./nvmCapabilities";

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

const EXAMPLES = [
	"Give me an overview of this dump and point out anything suspicious.",
	"List all DEM related blocks sorted by write order.",
	"What changed across the versions of <block>?",
	"Which blocks are written together with <block>?",
	"Arrange my workbench for investigating resets.",
];

/** Handle a deterministic command; returns true if it was handled. */
export function handleStaticCommand(command: string | undefined, caps: NvmCapabilities, stream: ChatTextStream): boolean {
	switch (command) {
		case "help":
			renderHelp(caps, stream);
			return true;
		case "why":
			renderWhy(caps, stream);
			return true;
		default:
			return false;
	}
}

/**
 * For `/explain`: the question to ask about the current selection, or a hint
 * string (prefixed "!") when nothing is selected.
 */
export function explainPrompt(caps: NvmCapabilities, userText: string): string {
	const focus = caps.ui.focus();
	if (!focus) {
		return "!Select a byte in the hex view or a row in the Blocks table first, then run `@nvm /explain` again.";
	}
	const target = focus.blockName
		? `block "${focus.blockName}"${focus.fieldName ? `, field "${focus.fieldName}"` : ""} at offset ${hex(focus.offset)}`
		: `offset ${hex(focus.offset)}`;
	const extra = userText.trim() ? ` The user adds: ${userText.trim()}` : "";
	return (
		`Explain the selected ${target} for an engineer new to this project: what it stores, how to read the ` +
		`current value, whether it looks plausible, and what to check next. Use nvm_analyzeBlock / nvm_getDecoded ` +
		`and cite the evidence.${extra}`
	);
}

function renderHelp(caps: NvmCapabilities, stream: ChatTextStream): void {
	const status = caps.status.explain();
	const out = [
		"**I'm @nvm — I analyze the open NVM dump with you.**",
		"",
		`Current dump: ${status.headline}`,
		"",
		"What you can ask:",
		"- *Overview & risks* — summaries, suspicious blocks, risk detection",
		"- *Find* — blocks by name, field or value; I can filter and sort the Blocks table for you",
		"- *History* — versions of a block, what changed per write, write timeline, blocks written together",
		"- *Explain* — select bytes or a row, then `/explain`",
		"- *Arrange* — open views or arrange the workbench (\"put the table left and hex right\")",
		"- *Notes* — I can propose notes/bookmarks (you confirm every write); `/note` saves my last conclusion as a short note",
		"",
		"Commands: `/explain` (current selection) · `/why` (why the dump was/wasn't recognized) · `/note [instruction]` (save the last answer as a note) · `/skills` · `/noskills`",
		"",
		"Try:",
		...EXAMPLES.map(e => `- ${e}`),
	];
	stream.markdown(out.join("\n"));
	stream.button?.({ command: "nvmStudio.workbench.showView", arguments: ["nvm.overview"], title: vscode.l10n.t("Open Overview") });
	stream.button?.({ command: "nvmStudio.nvm.askAboutSelection", title: vscode.l10n.t("Ask about my selection") });
}

function renderWhy(caps: NvmCapabilities, stream: ChatTextStream): void {
	stream.markdown(caps.status.explainText());
	const status = caps.status.diagnosis()?.status;
	if (status && status !== "loaded" && status !== "loading") {
		stream.button?.({ command: "nvmStudio.nvm.selectLayoutProfile", title: vscode.l10n.t("Select layout profile") });
		stream.button?.({ command: "nvmStudio.nvm.reloadLayout", title: vscode.l10n.t("Reload layout") });
	}
	stream.button?.({ command: "nvmStudio.nvm.showLog", title: vscode.l10n.t("Show NVM log") });
}
