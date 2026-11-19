// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Per-dump NVM load diagnostics: which descriptors were found, which declared
 * source files resolved, which provider produced how many blocks — or why
 * nothing was recognized. Recorded by the editor provider while loading and
 * read by the "Dumps & Config" view, the status capability (`@nvm /why`,
 * `nvm_loadStatus`) and the log. Vendor-blind: only generic descriptor facts.
 */

import * as vscode from "vscode";
import { LayoutConfig } from "../layout";

export type LoadStatus =
	/** The file type is not an NVM image format the loader reads. */
	| "unsupported"
	/** Loading has started but not finished. */
	| "loading"
	/** No `*.nvmlayout.json` descriptor was found near the dump. */
	| "noDescriptor"
	/** Descriptors exist but none produced blocks (no match / parse failure / engine blocked). */
	| "noBlocks"
	| "loaded"
	| "error";

export interface DescriptorInfo {
	name: string;
	/** How it parses: engine / engineScript / provider / structured / positional. */
	via: string;
	usesEngine: boolean;
}

export interface SourceInfo {
	logical: string;
	file: string;
	resolved: boolean;
	required: boolean;
}

export interface NvmLoadDiagnosis {
	fileName: string;
	dir: string;
	status: LoadStatus;
	descriptors: DescriptorInfo[];
	sources: SourceInfo[];
	/** Pinned layout profile (descriptor file), if the user chose one. */
	profile?: string;
	providerId?: string;
	blockCount: number;
	/** Extra human-readable detail (e.g. an error message). */
	message?: string;
	/** Why a declared external engine did not run (gate, missing pack, not confirmed). */
	engineIssue?: string;
	updatedAt: number;
}

/** One-line description of how a descriptor parses (shared with the log). */
export function describeDescriptor(c: LayoutConfig): DescriptorInfo {
	const via = c.engine
		? `engine "${c.engine}"`
		: c.engineScript
			? `engineScript "${c.engineScript}"`
			: c.provider
				? `provider "${c.provider}"`
				: (c as { profile?: unknown }).profile
					? "structured profile"
					: "positional blocks";
	return { name: c.vendor ?? "(unnamed)", via, usesEngine: !!(c.engine || c.engineScript) };
}

const empty = (fileName: string, dir: string): NvmLoadDiagnosis => ({
	fileName,
	dir,
	status: "loading",
	descriptors: [],
	sources: [],
	blockCount: 0,
	updatedAt: Date.now(),
});

export class LoadDiagnosticsStore implements vscode.Disposable {
	private readonly byUri = new Map<string, NvmLoadDiagnosis>();
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
	public readonly onDidChange = this.emitter.event;

	public get(uri: vscode.Uri): NvmLoadDiagnosis | undefined {
		return this.byUri.get(uri.toString());
	}

	/** Start (or restart) a load. */
	public begin(uri: vscode.Uri, fileName: string, dir: string): void {
		this.set(uri, empty(fileName, dir));
	}

	/** Merge facts discovered during the load. */
	public update(uri: vscode.Uri, patch: Partial<NvmLoadDiagnosis>): void {
		const current = this.byUri.get(uri.toString());
		if (current) {
			this.set(uri, { ...current, ...patch, updatedAt: Date.now() });
		}
	}

	/** Finish a load; the status follows from what was found. */
	public finish(uri: vscode.Uri, result: { blockCount: number; providerId?: string }): void {
		const current = this.byUri.get(uri.toString());
		if (!current || current.status === "unsupported") {
			return;
		}
		const status: LoadStatus =
			result.blockCount > 0 ? "loaded" : current.descriptors.length > 0 ? "noBlocks" : "noDescriptor";
		this.update(uri, { ...result, status });
	}

	public fail(uri: vscode.Uri, error: unknown): void {
		this.update(uri, { status: "error", message: error instanceof Error ? error.message : String(error) });
	}

	public forget(uri: vscode.Uri): void {
		if (this.byUri.delete(uri.toString())) {
			this.emitter.fire(uri);
		}
	}

	public dispose(): void {
		this.emitter.dispose();
	}

	private set(uri: vscode.Uri, d: NvmLoadDiagnosis): void {
		this.byUri.set(uri.toString(), d);
		this.emitter.fire(uri);
	}
}
