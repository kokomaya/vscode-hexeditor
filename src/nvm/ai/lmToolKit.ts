// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Shared plumbing for the Language Model Tools (loose access to the LM Tools
 * API, which postdates the pinned `@types/vscode`). Tool files only register
 * thin adapters through {@link LmApi} and format text — no data access here.
 */

import * as vscode from "vscode";
import { NvmCapabilityError } from "./capabilityTypes";

export const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

interface LmToolInvokeOptions<T> {
	input?: T;
}
interface LmToolPrepareOptions<T> {
	input?: T;
}
/** What `prepareInvocation` may return to drive VS Code's native confirmation UI. */
export interface LmToolPrepareResult {
	invocationMessage?: string;
	confirmationMessages?: { title: string; message: unknown };
}
export interface LmTool<T> {
	invoke(options: LmToolInvokeOptions<T>, token?: vscode.CancellationToken): Promise<unknown>;
	prepareInvocation?(
		options: LmToolPrepareOptions<T>,
		token?: vscode.CancellationToken,
	): LmToolPrepareResult | undefined;
}
export interface LmApi {
	registerTool<T>(name: string, tool: LmTool<T>): vscode.Disposable;
}

export function getLmApi(): LmApi | undefined {
	const lm = (vscode as unknown as { lm?: Partial<LmApi> }).lm;
	return lm && typeof lm.registerTool === "function" ? (lm as LmApi) : undefined;
}

/** Build a text tool result using whichever result class the host provides. */
export function textResult(result: string): unknown {
	const v = vscode as unknown as {
		LanguageModelToolResult?: new (parts: unknown[]) => unknown;
		LanguageModelTextPart?: new (s: string) => unknown;
	};
	if (v.LanguageModelToolResult && v.LanguageModelTextPart) {
		return new v.LanguageModelToolResult([new v.LanguageModelTextPart(result)]);
	}
	// Fallback shape accepted by early proposals.
	return { content: [{ kind: "text", value: result }] };
}

/** A MarkdownString for confirmation messages, or a plain string if unavailable. */
export function markdown(text: string): unknown {
	const v = vscode as unknown as { MarkdownString?: new (s: string) => unknown };
	return v.MarkdownString ? new v.MarkdownString(text) : text;
}

/** Wrap a capability call so {@link NvmCapabilityError} becomes a normal result. */
export async function guarded(fn: () => Promise<string> | string): Promise<unknown> {
	try {
		return textResult(await fn());
	} catch (e) {
		if (e instanceof NvmCapabilityError) {
			return textResult(e.message);
		}
		return textResult(`NVM tool error: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Append an optional section (e.g. the knowledge appendix) to a tool result. */
export function withSection(text: string, section: string): string {
	return section ? `${text}\n\n${section}` : text;
}
