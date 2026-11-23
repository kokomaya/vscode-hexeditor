// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The install server's engine listing (`GET /v1/engines`), validated. Engines
 * are organised as `<vendor>/[<layout>/]` folders; an engine's id is that
 * folder path ("vector/fee-v3"), which is also how descriptors and project
 * bindings reference it. Older packs may still be referenced by the `id` in
 * their `engine.json` (`manifestId`, e.g. "vector-fee-v3").
 */

import { isLevelName } from "../skills/hierarchy";
import { safeRelativePath } from "./safePath";

/** vendor / layout */
export const MAX_ENGINE_DEPTH = 2;
const MAX_FILES = 100;

export interface RemoteEngine {
	/** Folder path on the server, e.g. "vector/fee-v3". */
	id: string;
	path: string[];
	/** `id` field of the pack's engine.json, when it differs from the path (legacy references). */
	manifestId?: string;
	version?: string;
	displayName: string;
	description: string;
	sdkVersion?: number;
	/** Relative file paths inside the pack (always includes engine.json). */
	files: string[];
}

export interface RemoteVendor {
	id: string;
	title: string;
	description: string;
}

export interface EngineListing {
	engines: RemoteEngine[];
	vendors: RemoteVendor[];
}

/** Split an engine reference ("vector/fee-v3", optionally "@1.2.0") into folder segments. */
export function parseEngineRef(ref: unknown): string[] | undefined {
	if (typeof ref !== "string") {
		return undefined;
	}
	const parts = ref.split("@")[0].split(/[\\/]+/).filter(Boolean);
	return parts.length && parts.length <= MAX_ENGINE_DEPTH && parts.every(isLevelName) ? parts : undefined;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function parseEngine(raw: unknown): RemoteEngine | undefined {
	const e = raw as Record<string, unknown>;
	const path = parseEngineRef(e?.id);
	if (!path || !Array.isArray(e.files) || e.files.length > MAX_FILES) {
		return undefined;
	}
	const files = e.files.map(f => safeRelativePath(f, 5));
	if (files.some(f => f === undefined) || !files.includes("engine.json")) {
		return undefined;
	}
	const id = path.join("/");
	return {
		id,
		path,
		manifestId: str(e.manifestId),
		version: str(e.version),
		displayName: str(e.displayName) ?? id,
		description: str(e.description) ?? "",
		sdkVersion: typeof e.sdkVersion === "number" ? e.sdkVersion : undefined,
		files: files as string[],
	};
}

/** Validate a `/v1/engines` payload; unsafe entries are dropped, not repaired. */
export function parseEngineListing(payload: unknown): EngineListing {
	const p = payload as { engines?: unknown; vendors?: unknown };
	const engines = (Array.isArray(p?.engines) ? p.engines : []).map(parseEngine).filter((e): e is RemoteEngine => !!e);
	const vendors: RemoteVendor[] = [];
	for (const raw of Array.isArray(p?.vendors) ? p.vendors : []) {
		const v = raw as Record<string, unknown>;
		if (isLevelName(v?.id)) {
			vendors.push({ id: v.id, title: str(v.title) ?? v.id, description: str(v.description) ?? "" });
		}
	}
	return { engines, vendors };
}

/** The engine a reference points at: its folder path, or (legacy) its manifest id. */
export function findEngine(engines: readonly RemoteEngine[], ref: string): RemoteEngine | undefined {
	const path = parseEngineRef(ref)?.join("/");
	return path === undefined ? undefined : engines.find(e => e.id === path) ?? engines.find(e => e.manifestId === path);
}

/** Download URL of one pack file. */
export function engineFileUrl(base: string, engineId: string, rel: string): string {
	return `${base.replace(/\/+$/, "")}/v1/engines/file?engine=${encodeURIComponent(engineId)}&path=${encodeURIComponent(rel)}`;
}
