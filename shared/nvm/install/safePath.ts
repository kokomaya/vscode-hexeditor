// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isLevelName } from "../skills/hierarchy";

/**
 * Normalize a relative path from a server listing ("a/b/c.json") or return
 * undefined when it is unsafe: `..`, hidden or reserved names, absolute paths,
 * or deeper than `maxParts`. Everything the client writes to disk goes
 * through this, so a hostile listing cannot escape its install folder.
 */
export function safeRelativePath(rel: unknown, maxParts: number): string | undefined {
	if (typeof rel !== "string") {
		return undefined;
	}
	const parts = rel.split(/[\\/]+/).filter(Boolean);
	return parts.length && parts.length <= maxParts && parts.every(isLevelName) ? parts.join("/") : undefined;
}
