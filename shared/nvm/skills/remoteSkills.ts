// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The install server's skill listing (`GET /v1/skills`), validated. Skills
 * sit in the product / platform / project folder hierarchy (`hierarchy.ts`);
 * every name and path is checked so a malicious listing cannot write outside
 * the skill's own folder.
 */

import { safeRelativePath } from "../install/safePath";
import { formatHierarchyPath, HierarchyLevel, isLevelName, levelOf, parseHierarchyPath } from "./hierarchy";

export interface RemoteSkill {
	/** Folder path on the server, e.g. "radar/chipA/reset-counter". */
	id: string;
	name: string;
	/** Level folders above the skill ([] = general). */
	path: string[];
	level: HierarchyLevel;
	kind?: string;
	description: string;
	version?: string;
	/** Relative file paths inside the skill folder (always includes SKILL.md). */
	files: string[];
	/** Content hash (shared/nvm/install/contentHash.ts); absent on older servers. */
	hash?: string;
}

export interface RemoteLevel {
	path: string[];
	level: HierarchyLevel;
	title: string;
	description: string;
	/**
	 * Project binding from the level's `level.json`: engine refs ("vector/fee-v3") and
	 * descriptor paths under the server's conf/. Undefined = not set here (inherited).
	 */
	engines?: string[];
	configs?: string[];
}

export interface SkillListing {
	skills: RemoteSkill[];
	levels: RemoteLevel[];
}

const MAX_FILES = 200;
const MAX_FILE_DEPTH = 5;

/** Normalized relative file path, or undefined when unsafe (`..`, hidden, separators). */
export const safeSkillPath = (rel: unknown) => safeRelativePath(rel, MAX_FILE_DEPTH);

/** A string list from a listing (undefined when absent, so "unset" differs from "empty"). */
const stringList = (v: unknown): string[] | undefined =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : undefined;

function parseSkill(raw: unknown): RemoteSkill | undefined {
	const s = raw as Record<string, unknown>;
	const path = parseHierarchyPath(s?.path ?? []);
	if (!isLevelName(s?.name) || !path || !Array.isArray(s.files) || s.files.length > MAX_FILES) {
		return undefined;
	}
	const id = formatHierarchyPath([...path, s.name]);
	const files = s.files.map(safeSkillPath);
	if ((s.id !== undefined && s.id !== id) || files.some(f => f === undefined) || !files.includes("SKILL.md")) {
		return undefined;
	}
	return {
		id,
		name: s.name,
		path,
		level: levelOf(path),
		kind: typeof s.kind === "string" ? s.kind : undefined,
		description: typeof s.description === "string" ? s.description : "",
		version: typeof s.version === "string" ? s.version : undefined,
		files: files as string[],
		hash: typeof s.hash === "string" && s.hash ? s.hash : undefined,
	};
}

/** Validate a `/v1/skills` payload; unsafe entries are dropped, not repaired. */
export function parseSkillListing(payload: unknown): SkillListing {
	const p = payload as { skills?: unknown; levels?: unknown };
	const skills = (Array.isArray(p?.skills) ? p.skills : []).map(parseSkill).filter((s): s is RemoteSkill => !!s);
	const levels: RemoteLevel[] = [];
	for (const raw of Array.isArray(p?.levels) ? p.levels : []) {
		const l = raw as Record<string, unknown>;
		const path = parseHierarchyPath(l?.path);
		if (path?.length) {
			levels.push({
				path,
				level: levelOf(path),
				title: typeof l.title === "string" && l.title ? l.title : path[path.length - 1],
				description: typeof l.description === "string" ? l.description : "",
				engines: stringList(l.engines),
				configs: stringList(l.configs),
			});
		}
	}
	return { skills, levels };
}

/** Download URL of one skill file. */
export function skillFileUrl(base: string, skillId: string, rel: string): string {
	return `${base.replace(/\/+$/, "")}/v1/skills/file?skill=${encodeURIComponent(skillId)}&path=${encodeURIComponent(rel)}`;
}
