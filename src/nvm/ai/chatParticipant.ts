// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * `@nvm` chat participant: reuses the built-in Copilot Chat UI so users can ask
 * questions about the active NVM dump in natural language. The handler gathers a
 * compact context (blocks + annotations) from the active hex editor and forwards
 * the conversation to the user's selected language model.
 *
 * The Chat API postdates this extension's `@types/vscode` baseline, so it is
 * accessed loosely and guarded — nothing registers on hosts without the API, and
 * the "Ask NVM AI" command falls back to opening the chat with the NVM tools.
 */

import * as vscode from "vscode";
import { emitEvidenceButtons, nvmFollowups, recordingStream, registerChatUiCommands } from "./chatUi";
import { preparePrompt } from "./chatPrompt";
import { tryOpenChat } from "./openChat";
import { formatSkillLine } from "./lmSkillTools";
import { NvmCapabilities } from "./nvmCapabilities";

interface ChatApi {
	createChatParticipant(id: string, handler: (...args: unknown[]) => unknown): vscode.Disposable;
}

function getChatApi(): ChatApi | undefined {
	const chat = (vscode as unknown as { chat?: Partial<ChatApi> }).chat;
	return chat && typeof chat.createChatParticipant === "function" ? (chat as ChatApi) : undefined;
}

/** Build a compact, model-friendly context for the active dump (via the facade). */
async function buildContext(caps: NvmCapabilities): Promise<string> {
	try {
		const o = caps.describeDump();
		const annotations = await caps.listAnnotations();
		const lines: string[] = [];
		lines.push(
			`Dump: ${o.totalBlocks} blocks (decoded ${o.decodedBlocks}, ${o.distinctStructures} distinct structures). ` +
				`Annotations: ${annotations.bookmarks.length} bookmarks, ${annotations.tags.length} tags, ${annotations.notes.length} notes.`,
		);
		if (o.nameFamilies.length) {
			lines.push("", "Top block name families (name* : count):");
			for (const f of o.nameFamilies.slice(0, 25)) {
				lines.push(`- ${f.key} : ${f.count}`);
			}
			if (o.truncated.nameFamilies) {
				lines.push("- … more families (use #nvmDescribeDump for the full aggregate)");
			}
		}
		for (const a of o.attributes.slice(0, 4)) {
			const vals = a.values.slice(0, 8).map(v => `${v.key}(${v.count})`).join(", ");
			lines.push("", `${a.label}: ${vals}`);
		}
		const focus = caps.ui.describeFocus();
		if (focus) {
			lines.push("", `Current selection: ${focus}`);
		}
		return lines.join("\n");
	} catch (e) {
		return e instanceof Error ? e.message : "There is no active NVM dump open in the hex editor.";
	}
}

/** Max tool-calling rounds per request (skill loading costs a round). */
function maxRounds(): number {
	const n = vscode.workspace.getConfiguration("nvmstudio").get<number>("nvm.chat.maxToolRounds", 8);
	return Math.min(Math.max(1, Math.floor(n || 8)), 20);
}

/** `@nvm /skills`: what is installed, what binds to the active dump, what is broken. */
async function renderSkillsOverview(caps: NvmCapabilities): Promise<string> {
	if (!caps.skills.available) {
		return "NVM skills are disabled (`nvmstudio.nvm.skills.mode` is `off`).";
	}
	const page = await caps.skills.listSkills({ limit: 100 });
	const diags = (await caps.skills.diagnostics()).filter(d => d.severity !== "info");
	const out = [`**${page.total} skill(s)** available:`, "", ...page.items.map(formatSkillLine)];
	if (!vscode.workspace.isTrusted) {
		out.push("", "_Workspace is untrusted: only user-home and built-in skills are loaded._");
	}
	if (diags.length) {
		out.push("", `**${diags.length} problem(s)** (run *NVM: Show Skill Diagnostics*):`);
		out.push(...diags.slice(0, 15).map(d => `- ${d.severity}: ${d.skill ?? ""} ${d.message}`));
	}
	out.push("", "Force a skill with `skill:<name>` in your question; disable auto skills with `/noskills`.");
	return out.join("\n");
}

/**
 * Register the `@nvm` chat participant (when the API exists) plus the
 * `nvmStudio.nvm.openChat` command that opens Copilot Chat prefilled for NVM.
 */
export function registerChatParticipant(caps: NvmCapabilities): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];
	const chat = getChatApi();

	if (chat) {
		const handler = async (
			request: { prompt: string; command?: string; model?: unknown; toolInvocationToken?: unknown },
			_context: unknown,
			rawStream: {
				markdown(v: string): void;
				progress?(v: string): void;
				button?(command: vscode.Command): void;
			},
			token: vscode.CancellationToken,
		): Promise<void> => {
			const recorder = recordingStream(rawStream);
			const stream = recorder.stream;
			if (request.command === "skills") {
				stream.markdown(await renderSkillsOverview(caps));
				return;
			}
			const ctx = await buildContext(caps);
			const prepared = await preparePrompt(caps, request.prompt, ctx, {
				noSkills: request.command === "noskills",
			});
			for (const name of prepared.activated) {
				stream.progress?.(`Using skill: ${name}`);
			}
			if (prepared.unknown.length) {
				stream.markdown(`_Unknown skill(s): ${prepared.unknown.join(", ")} — see \`@nvm /skills\`._\n\n`);
			}
			const model = (request as { model?: LanguageModelLike }).model;
			if (!model || typeof model.sendRequest !== "function") {
				stream.markdown(
					"No language model is available. Here is the current NVM context:\n\n```\n" + ctx + "\n```",
				);
				return;
			}
			const system = prepared.system;
			try {
				// Preferred path: let the model iteratively call the #nvm* tools so it
				// can fetch exact counts / drill into blocks. Falls back to a single
				// pass with the aggregate context when the tool-calling API is absent.
				const usedTools = await runWithTools(
					model,
					system,
					prepared.prompt,
					stream,
					token,
					request.toolInvocationToken,
				);
				if (!usedTools) {
					const messages = buildMessages(system, prepared.prompt);
					const response = await model.sendRequest(messages, {}, token);
					for await (const fragment of response.text) {
						stream.markdown(fragment);
					}
				}
				// Make the answer verifiable: one-click "show" buttons for mentioned blocks.
				emitEvidenceButtons(rawStream, caps, recorder.text());
			} catch (e) {
				stream.markdown(`AI request failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		};

		try {
			const participant = chat.createChatParticipant("nvmStudio.nvm", handler as never) as vscode.Disposable & {
				followupProvider?: { provideFollowups(): { prompt: string; label: string }[] };
			};
			participant.followupProvider = { provideFollowups: () => nvmFollowups(caps) };
			disposables.push(participant);
		} catch (e) {
			console.warn("NVM chat participant registration failed:", e);
		}
	}

	disposables.push(...registerChatUiCommands(caps));
	disposables.push(
		vscode.commands.registerCommand("nvmStudio.nvm.openChat", async () => {
			// Prefer opening Copilot Chat addressed to our participant; fall back to
			// a report-context message if the participant/API is unavailable.
			const opened = await tryOpenChat("@nvm ");
			if (!opened) {
				let hasDump = false;
				try {
					caps.listBlocks({ limit: 1 });
					hasDump = true;
				} catch {
					hasDump = false;
				}
				const query = hasDump
					? `Analyze this NVM dump. Use #nvmListBlocks and #nvmRiskDetection.`
					: "Open an NVM dump, then ask about it here.";
				await tryOpenChat(query);
			}
		}),
	);

	return disposables;
}

interface LanguageModelLike {
	sendRequest(
		messages: unknown[],
		options: unknown,
		token: vscode.CancellationToken,
	): Promise<{ text: AsyncIterable<string>; stream?: AsyncIterable<unknown> }>;
}

/**
 * Run the model with the `nvm_*` language-model tools bound, looping to service
 * tool calls, and stream the assistant text. Returns false (without emitting)
 * when the tool-calling API classes are unavailable, so the caller can fall
 * back to a single-pass request. All API access is loose + guarded because the
 * tool-calling API postdates this extension's `@types/vscode` baseline.
 */
async function runWithTools(
	model: LanguageModelLike,
	system: string,
	prompt: string,
	stream: { markdown(v: string): void; progress?(v: string): void },
	token: vscode.CancellationToken,
	toolInvocationToken: unknown,
): Promise<boolean> {
	const v = vscode as unknown as {
		lm?: { tools?: { name: string; description?: string; inputSchema?: unknown }[]; invokeTool?: (...a: unknown[]) => Promise<unknown> };
		LanguageModelChatMessage?: { User(v: unknown): unknown; Assistant(v: unknown): unknown };
		LanguageModelToolCallPart?: new (...a: unknown[]) => unknown;
		LanguageModelToolResultPart?: new (callId: string, content: unknown[]) => unknown;
		LanguageModelTextPart?: new (s: string) => unknown;
	};
	const lm = v.lm;
	const Msg = v.LanguageModelChatMessage;
	const ToolCallPart = v.LanguageModelToolCallPart;
	const ToolResultPart = v.LanguageModelToolResultPart;
	const TextPart = v.LanguageModelTextPart;
	if (
		!lm ||
		typeof lm.invokeTool !== "function" ||
		!Array.isArray(lm.tools) ||
		!Msg ||
		typeof Msg.User !== "function" ||
		typeof Msg.Assistant !== "function" ||
		!ToolCallPart ||
		!ToolResultPart ||
		!TextPart
	) {
		return false;
	}
	const tools = lm.tools
		.filter(t => typeof t.name === "string" && t.name.startsWith("nvm_"))
		.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
	if (tools.length === 0) {
		return false;
	}

	const messages: unknown[] = [Msg.User(`${system}\n\n${prompt}`)];
	const MAX_ROUNDS = maxRounds();
	for (let round = 0; round < MAX_ROUNDS; round++) {
		if (token.isCancellationRequested) {
			return true;
		}
		const response = await model.sendRequest(messages, { tools }, token);
		const parts = response.stream ?? response.text;
		const toolCalls: { callId: string; name: string; input: unknown; part: unknown }[] = [];
		const assistantParts: unknown[] = [];
		for await (const part of parts as AsyncIterable<unknown>) {
			if (typeof part === "string") {
				stream.markdown(part);
				continue;
			}
			const p = part as { value?: unknown; callId?: string; name?: string; input?: unknown };
			if (typeof p.callId === "string" && typeof p.name === "string") {
				toolCalls.push({ callId: p.callId, name: p.name, input: p.input, part });
				assistantParts.push(part);
			} else if (typeof p.value === "string") {
				stream.markdown(p.value);
			}
		}
		if (toolCalls.length === 0) {
			return true;
		}
		messages.push(Msg.Assistant(assistantParts));
		const resultParts: unknown[] = [];
		for (const call of toolCalls) {
			if (call.name === "nvm_useSkill") {
				const n = (call.input as { name?: string } | undefined)?.name;
				stream.progress?.(`Using skill: ${n ?? "?"}`);
			}
			let resultText: string;
			try {
				const res = await lm.invokeTool(
					call.name,
					{ input: call.input ?? {}, toolInvocationToken },
					token,
				);
				resultText = extractToolText(res);
			} catch (e) {
				resultText = `Tool ${call.name} failed: ${e instanceof Error ? e.message : String(e)}`;
			}
			resultParts.push(new ToolResultPart(call.callId, [new TextPart(resultText)]));
		}
		messages.push(Msg.User(resultParts));
	}
	stream.markdown(
		`\n\n_Stopped after ${MAX_ROUNDS} tool rounds (setting \`nvmstudio.nvm.chat.maxToolRounds\`). Ask me to continue for more._`,
	);
	return true;
}

/** Flatten a LanguageModelToolResult's content parts into a text string. */
function extractToolText(res: unknown): string {
	const content = (res as { content?: unknown })?.content;
	if (!Array.isArray(content)) {
		return typeof res === "string" ? res : "";
	}
	return content
		.map(p => (typeof (p as { value?: unknown })?.value === "string" ? (p as { value: string }).value : ""))
		.join("");
}

/** Build chat messages using whichever message class the host provides. */
function buildMessages(system: string, user: string): unknown[] {
	const v = vscode as unknown as {
		LanguageModelChatMessage?: { User(v: string): unknown };
	};
	if (v.LanguageModelChatMessage && typeof v.LanguageModelChatMessage.User === "function") {
		return [v.LanguageModelChatMessage.User(`${system}\n\n${user}`)];
	}
	return [{ role: "user", content: `${system}\n\n${user}` }];
}
