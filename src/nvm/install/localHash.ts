// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Hash an installed copy the same way the install server hashes its copy
 * (`shared/nvm/install/contentHash.ts`), over the file list the server
 * announced. A missing local file hashes as empty — like on the server — so a
 * deleted or never-downloaded file shows up as a difference.
 */

import * as vscode from "vscode";
import { contentHash } from "../../../shared/nvm/install/contentHash";

const decoder = new TextDecoder("utf-8");

export async function localContentHash(dir: vscode.Uri, rels: readonly string[]): Promise<string> {
	const files = await Promise.all(
		rels.map(async path => {
			try {
				return { path, text: decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, ...path.split("/")))) };
			} catch {
				return { path, text: "" };
			}
		}),
	);
	return contentHash(files);
}
