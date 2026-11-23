// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Pure helpers for `@nvm /note`: find the answer to summarize in the chat
 * history, build the summarization prompt (default or user-guided), and parse
 * the model's reply into a note title + body. No vscode API, so it is unit
 * tested directly.
 */

export interface ChatTurnPair {
	question: string;
	answer: string;
}

const MAX_ANSWER_CHARS = 12000;
const MAX_TITLE = 80;

export const DEFAULT_NOTE_INSTRUCTION =
	"Summarize the conclusion only: what was found, the key evidence (block names, values, offsets) and the recommended next step.";

/** Text of one history response part (markdown parts carry `value.value` or `value`). */
function partText(part: unknown): string {
	const value = (part as { value?: unknown })?.value;
	if (typeof value === "string") {
		return value;
	}
	const inner = (value as { value?: unknown })?.value;
	return typeof inner === "string" ? inner : "";
}

/**
 * The most recent question/answer pair of `participantId` in a chat history
 * (`vscode.ChatContext.history`, accessed loosely). Undefined if none.
 */
export function lastExchange(history: readonly unknown[], participantId: string): ChatTurnPair | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const turn = history[i] as { participant?: string; response?: unknown[]; command?: string };
		if (!Array.isArray(turn?.response) || (turn.participant && turn.participant !== participantId)) {
			continue;
		}
		const answer = turn.response.map(partText).join("").trim();
		if (!answer) {
			continue;
		}
		const req = history
			.slice(0, i)
			.reverse()
			.find(t => typeof (t as { prompt?: unknown }).prompt === "string") as { prompt: string } | undefined;
		return { question: req?.prompt ?? "", answer };
	}
	return undefined;
}

/** The prompt asking the model for a concise note. */
export function buildNotePrompt(exchange: ChatTurnPair, instruction: string): string {
	const answer =
		exchange.answer.length > MAX_ANSWER_CHARS ? `${exchange.answer.slice(0, MAX_ANSWER_CHARS)}\n…` : exchange.answer;
	return [
		"You write short engineering notes that are attached to a location in an NVM memory dump.",
		"Turn the analysis below into a note. Be concise: no preamble, no repetition, no speculation beyond the analysis.",
		"Format exactly:",
		"Line 1: a title of at most 8 words (no markdown, no quotes).",
		"Then 2 to 5 markdown bullet points (each at most 25 words).",
		"",
		`Instruction: ${instruction.trim() || DEFAULT_NOTE_INSTRUCTION}`,
		"",
		"--- Question ---",
		exchange.question || "(not available)",
		"--- Analysis ---",
		answer,
	].join("\n");
}

/** Split the model reply into a title and a body (robust to stray markdown). */
export function parseNoteReply(reply: string, fallbackTitle: string): { title: string; body: string } {
	const lines = reply
		.replace(/^```[a-z]*\s*|```\s*$/gi, "")
		.split(/\r?\n/)
		.map(l => l.trimEnd());
	while (lines.length && !lines[0].trim()) {
		lines.shift();
	}
	const first = (lines[0] ?? "").replace(/^#+\s*|^\*\*|\*\*$|^title:\s*/gi, "").replace(/^["']|["']$/g, "").trim();
	const looksLikeTitle = !!first && !/^[-*]\s/.test(lines[0] ?? "");
	const title = (looksLikeTitle ? first : fallbackTitle).slice(0, MAX_TITLE);
	const body = (looksLikeTitle ? lines.slice(1) : lines).join("\n").trim();
	return { title, body: body || first || fallbackTitle };
}
