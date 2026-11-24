// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Content hash of an installable item (engine pack, skill folder, descriptor
 * + the shared files it requires), so the client can tell "the server copy
 * changed" even when nobody bumped a version. Must stay byte-identical to
 * `contentHash()` in `server/fsutil.js`:
 *
 *   sha256( for each file sorted by path: path + "\0" + normalize(text) + "\0" )  → hex
 *
 * `normalize` drops a leading BOM and turns CRLF into LF, because downloads go
 * through `fetch().text()` (which strips the BOM) and editors on either side
 * may change line endings without changing content.
 */

export const normalizeHashText = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, "\n");

/** The exact string that is hashed (exported for tests). */
export function contentHashInput(files: readonly { path: string; text: string }[]): string {
	return [...files]
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
		.map(f => `${f.path}\0${normalizeHashText(f.text)}\0`)
		.join("");
}

/** SHA-256 hex via WebCrypto (available in the node extension host and in browsers). */
export async function contentHash(files: readonly { path: string; text: string }[]): Promise<string> {
	const data = new TextEncoder().encode(contentHashInput(files));
	const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
