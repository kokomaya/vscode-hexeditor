// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Makes @nvm answers actionable: every answer ends with "show me" buttons for
 * the blocks it mentions (so each claim can be verified in the table / hex
 * view with one click), plus suggested follow-up questions. The buttons are
 * derived from the dump's real block names — never from model-provided links.
 */

import * as vscode from "vscode";
import { NvmCapabilities } from "./nvmCapabilities";

const MAX_EVIDENCE_BUTTONS = 5;
const MIN_NAME_LENGTH = 4;
export const REVEAL_BLOCK_COMMAND = "nvmStudio.nvm.revealBlock";

export interface ChatTextStream {
	markdown(v: string): void;
	progress?(v: string): void;
	button?(command: vscode.Command): void;
}

/** Wrap a chat stream so the answer text can be inspected afterwards. */
export function recordingStream(stream: ChatTextStream): { stream: ChatTextStream; text(): string } {
	const chunks: string[] = [];
	return {
		stream: {
			markdown: v => {
				chunks.push(v);
				stream.markdown(v);
			},
			progress: stream.progress?.bind(stream),
			button: stream.button?.bind(stream),
		},
		text: () => chunks.join(""),
	};
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Block names of the active dump that the answer mentions (whole-word, longest first). */
export function mentionedBlocks(caps: NvmCapabilities, text: string): string[] {
	let names: string[];
	try {
		names = [...new Set(caps.ui.blockNames())];
	} catch {
		return [];
	}
	names.sort((a, b) => b.length - a.length);
	const found: string[] = [];
	let remaining = text;
	for (const name of names) {
		if (found.length >= MAX_EVIDENCE_BUTTONS) {
			break;
		}
		if (name.length < MIN_NAME_LENGTH || !remaining.includes(name)) {
			continue;
		}
		const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`, "g");
		if (re.test(remaining)) {
			found.push(name);
			// Blank out matches so shorter names inside this one don't match again.
			remaining = remaining.replace(re, "$1");
		}
	}
	return found;
}

/** Append "show in editor" buttons for the blocks an answer mentions. */
export function emitEvidenceButtons(stream: ChatTextStream, caps: NvmCapabilities, text: string): void {
	if (typeof stream.button !== "function") {
		return;
	}
	const names = mentionedBlocks(caps, text);
	if (!names.length) {
		return;
	}
	stream.markdown("\n\n");
	for (const name of names) {
		stream.button({
			command: REVEAL_BLOCK_COMMAND,
			title: vscode.l10n.t("Show {0}", name),
			arguments: [name],
		});
	}
}

/** Follow-up suggestions, adapted to whether the user has a block in focus. */
export function nvmFollowups(caps: NvmCapabilities): { prompt: string; label: string }[] {
	const focus = caps.ui.focus();
	if (focus?.blockName) {
		return [
			{ label: "History", prompt: `What changed across the versions of ${focus.blockName}?` },
			{ label: "Timeline", prompt: `What was written around ${focus.blockName}?` },
			{ label: "Related", prompt: `Which blocks are usually written together with ${focus.blockName}?` },
		];
	}
	return [
		{ label: "Risks", prompt: "Run a risk detection on this dump and explain the findings." },
		{ label: "Recent writes", prompt: "Which blocks were written most recently?" },
		{ label: "Arrange", prompt: "Arrange my workbench for investigating this dump." },
	];
}

export function registerChatUiCommands(caps: NvmCapabilities): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(REVEAL_BLOCK_COMMAND, (name: string) => {
			try {
				caps.ui.reveal({ block: name });
			} catch (e) {
				void vscode.window.showWarningMessage(e instanceof Error ? e.message : String(e));
			}
		}),
	];
}
