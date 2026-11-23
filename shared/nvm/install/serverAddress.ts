// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** The install server's default port (`server/index.js`). */
export const DEFAULT_SERVER_PORT = 7788;

/**
 * Turn what a user types into a server base URL:
 *   "10.1.2.3"            → "http://10.1.2.3:7788"
 *   "nvm-server:8080"     → "http://nvm-server:8080"
 *   "https://nvm.corp/x/" → "https://nvm.corp/x"   (an explicit scheme keeps its port / path)
 * Returns undefined when it is not a usable http(s) address.
 */
export function normalizeServerBase(input: string): string | undefined {
	const text = input.trim();
	if (!text) {
		return undefined;
	}
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
	let url: URL;
	try {
		url = new URL(hasScheme ? text : `http://${text}`);
	} catch {
		return undefined;
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
		return undefined;
	}
	if (!hasScheme && !url.port) {
		url.port = String(DEFAULT_SERVER_PORT);
	}
	return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
}
