// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * `@nvm /note [instruction]`: condense the previous @nvm answer into a short
 * note and attach it where it belongs — the block the user names, else the
 * first block the answer mentions, else the current selection. The user asked
 * for it explicitly, so no extra confirmation is shown; the note is written
 * through the same validated `createNote` path as AI tool notes.
 */

import * as vscode from "vscode";
import { buildNotePrompt, lastExchange, parseNoteReply } from "./conclusionNote";
import { ChatTextStream, mentionedBlocks } from "./chatUi";
import { CreateNoteInput, NvmCapabilities } from "./nvmCapabilities";
import { tryOpenChat } from "./openChat";

export const NOTE_COMMAND = "note";
export const PARTICIPANT_ID = "nvmStudio.nvm";
const SAVE_AS_NOTE_COMMAND = "nvmStudio.nvm.saveAnswerAsNote";
const OPEN_NOTE_COMMAND = "nvmStudio.nvm.openNoteNode";

export interface NoteModel {
	sendRequest(
		messages: unknown[],
		options: unknown,
		token: vscode.CancellationToken,
	): Promise<{ text: AsyncIterable<string> }>;
}

type Anchor = Pick<CreateNoteInput, "blockName" | "start"> & { label: string };

function chooseAnchor(caps: NvmCapabilities, instruction: string, answer: string): Anchor | undefined {
	const named = mentionedBlocks(caps, instruction)[0] ?? mentionedBlocks(caps, answer)[0];
	if (named) {
		return { blockName: named, label: named };
	}
	const focus = caps.ui.focus();
	if (focus?.blockName) {
		return { blockName: focus.blockName, label: focus.blockName };
	}
	return focus ? { start: focus.offset, label: `0x${focus.offset.toString(16).toUpperCase()}` } : undefined;
}

function userMessage(text: string): unknown {
	const Msg = (vscode as unknown as { LanguageModelChatMessage?: { User(v: string): unknown } }).LanguageModelChatMessage;
	return Msg && typeof Msg.User === "function" ? Msg.User(text) : { role: "user", content: text };
}

export async function handleNoteCommand(
	caps: NvmCapabilities,
	instruction: string,
	history: readonly unknown[],
	model: NoteModel | undefined,
	stream: ChatTextStream,
	token: vscode.CancellationToken,
): Promise<void> {
	const exchange = lastExchange(history, PARTICIPANT_ID);
	if (!exchange) {
		stream.markdown("There is no previous @nvm answer in this conversation to summarize. Ask a question first, then run `/note`.");
		return;
	}
	const anchor = chooseAnchor(caps, instruction, exchange.answer);
	if (!anchor) {
		stream.markdown("I can't tell where to attach the note. Select a block in the table or hex view (or name it: `/note <block name>`), then run `/note` again.");
		return;
	}
	if (!model || typeof model.sendRequest !== "function") {
		stream.markdown("No language model is available to write the summary.");
		return;
	}

	stream.progress?.("Summarizing the conclusion…");
	const response = await model.sendRequest([userMessage(buildNotePrompt(exchange, instruction))], {}, token);
	let reply = "";
	for await (const fragment of response.text) {
		reply += fragment;
	}
	const { title, body } = parseNoteReply(reply, `Conclusion: ${anchor.label}`);
	const result = await caps.createNote({
		blockName: anchor.blockName,
		start: anchor.start,
		title,
		body: `${body}\n\n_Saved from an @nvm conversation on ${new Date().toISOString().slice(0, 10)}._`,
	});
	if (!result.created) {
		stream.markdown(`The note was not created: ${result.reason ?? "unknown reason"}.`);
		return;
	}
	stream.markdown(`📝 Saved note **${title}** on **${anchor.label}**:\n\n${body}\n`);
	if (result.noteId) {
		stream.button?.({ command: OPEN_NOTE_COMMAND, title: vscode.l10n.t("Open note"), arguments: [{ id: result.noteId }] });
	}
}

/** "Save as note…" under an answer: pre-fills `@nvm /note ` so the user may add an instruction. */
export function emitSaveAsNoteButton(stream: ChatTextStream): void {
	stream.button?.({ command: SAVE_AS_NOTE_COMMAND, title: vscode.l10n.t("Save conclusion as note…") });
}

export function registerChatNoteCommands(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(SAVE_AS_NOTE_COMMAND, async () => {
			if (!(await tryOpenChat(`@nvm /${NOTE_COMMAND} `))) {
				void vscode.window.showInformationMessage(vscode.l10n.t("Chat is not available."));
			}
		}),
	];
}
