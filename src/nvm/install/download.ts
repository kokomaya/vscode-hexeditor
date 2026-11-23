// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Download helpers shared by every install-from-server path (engines, layout
 * descriptors, skills). A folder is only replaced after all of its files were
 * downloaded, so a failed download never leaves a half-installed pack.
 */

import * as vscode from "vscode";

const PARALLEL_DOWNLOADS = 4;

export async function fetchText(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`${res.status} ${res.statusText} for ${url}`);
	}
	return res.text();
}

export async function fetchJson(url: string): Promise<unknown> {
	return JSON.parse(await fetchText(url));
}

export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

/**
 * Download `files` (relative path → URL; paths already validated by the
 * caller) and replace `dir` with exactly those files.
 */
export async function downloadFolder(dir: vscode.Uri, files: readonly { rel: string; url: string }[]): Promise<void> {
	const contents: [string, string][] = [];
	for (let i = 0; i < files.length; i += PARALLEL_DOWNLOADS) {
		const batch = files.slice(i, i + PARALLEL_DOWNLOADS);
		const texts = await Promise.all(batch.map(f => fetchText(f.url)));
		batch.forEach((f, j) => contents.push([f.rel, texts[j]]));
	}
	try {
		await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
	} catch {
		// not installed yet
	}
	for (const [rel, text] of contents) {
		await writeText(vscode.Uri.joinPath(dir, ...rel.split("/")), text);
	}
}
