// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The install server's layout-descriptor listing (`GET /v1/configs`),
 * validated. Descriptors live under `conf/` in any folder structure (usually
 * mirroring the skills' product / platform / project) and are addressed by
 * their relative path. The listing also carries what the client needs to plan
 * an install without downloading first: referenced engines and `skillContext`.
 */

import { safeRelativePath } from "./safePath";

const SUFFIX = ".nvmlayout.json";
/** Shared files a descriptor may require (reusable struct packs). */
const SHARED_SUFFIXES = [".nvmstructs.json"];
const MAX_PARTS = 5;

export interface RemoteConfig {
	/** Relative path under the server's conf/, e.g. "radar/chipA/customerB/x.nvmlayout.json". */
	path: string;
	vendor?: string;
	/** Engine references found in the descriptor (`"engine"`). */
	engines: string[];
	skillContext?: string;
	/**
	 * Shared files (paths under conf/) the descriptor references relative to
	 * itself; installed alongside it so the reference still resolves.
	 */
	requires: string[];
	/** Content hash of the descriptor + its `requires`; absent on older servers. */
	hash?: string;
	/** Server-provided download URL, kept only for older servers that have no file route. */
	downloadUrl?: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Validate a `/v1/configs` payload; unsafe entries are dropped. Old servers list `name` only. */
export function parseConfigListing(payload: unknown): RemoteConfig[] {
	const list = (payload as { configs?: unknown })?.configs;
	const out: RemoteConfig[] = [];
	for (const raw of Array.isArray(list) ? list : []) {
		const c = raw as Record<string, unknown>;
		const path = safeRelativePath(c?.path ?? c?.name, MAX_PARTS);
		if (!path || !path.toLowerCase().endsWith(SUFFIX)) {
			continue;
		}
		out.push({
			path,
			vendor: str(c.vendor),
			engines: Array.isArray(c.engines) ? c.engines.filter((e): e is string => typeof e === "string" && !!e) : [],
			skillContext: str(c.skillContext),
			requires: parseRequires(c.requires),
			hash: str(c.hash),
			// Only trusted for old servers: a proxied server may report its own host wrongly.
			downloadUrl: c.path === undefined ? str(c.downloadUrl) : undefined,
		});
	}
	return out;
}

/** Keep only safe conf/ paths with a shared-file suffix. */
function parseRequires(raw: unknown): string[] {
	const out = new Set<string>();
	for (const r of Array.isArray(raw) ? raw : []) {
		const p = safeRelativePath(r, MAX_PARTS);
		if (p && SHARED_SUFFIXES.some(s => p.toLowerCase().endsWith(s))) {
			out.add(p);
		}
	}
	return [...out];
}

/** Where to download a descriptor from. */
export function configFileUrl(base: string, config: RemoteConfig): string {
	const root = base.replace(/\/+$/, "");
	return config.downloadUrl
		? new URL(config.downloadUrl, `${root}/`).toString()
		: confFileUrl(base, config.path);
}

/** Download URL of any servable file under conf/ (descriptor or a shared file it requires). */
export function confFileUrl(base: string, relPath: string): string {
	return `${base.replace(/\/+$/, "")}/v1/configs/file?path=${encodeURIComponent(relPath)}`;
}
