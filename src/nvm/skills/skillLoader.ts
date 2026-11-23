// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * File-system side of skills: scan a root for `<skill>/SKILL.md`, read bodies,
 * catalogs and resources. All parsing is delegated to the pure kernel
 * (`shared/nvm/skills`). Resource access is confined to the skill's own
 * directory (no `..`, no absolute paths).
 */

import * as vscode from "vscode";
import { NvmStructCatalog, parseStructCatalog } from "../../../shared/nvm/structRich";
import { MAX_HIERARCHY_DEPTH } from "../../../shared/nvm/skills/hierarchy";
import { parseSkill, safeRelativePath } from "../../../shared/nvm/skills/meta";
import { SkillDiagnostic, SkillMeta } from "../../../shared/nvm/skills/types";
import { SkillRoot } from "./skillRoots";

const SKILL_FILE = "SKILL.md";
const MAX_RESOURCES = 50;
const decoder = new TextDecoder("utf8");

async function readText(uri: vscode.Uri): Promise<string> {
	return decoder.decode(await vscode.workspace.fs.readFile(uri));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export interface ScanResult {
	skills: SkillMeta[];
	diagnostics: SkillDiagnostic[];
}

/**
 * Scan one root. A folder with `SKILL.md` is a skill; any other folder is a
 * hierarchy level (product / platform / project, max three deep) and is
 * descended into. See `shared/nvm/skills/hierarchy.ts`.
 */
export async function scanRoot(root: SkillRoot): Promise<ScanResult> {
	const out: ScanResult = { skills: [], diagnostics: [] };
	await scanLevel(root, root.uri, [], out);
	return out;
}

async function scanLevel(root: SkillRoot, uri: vscode.Uri, path: string[], out: ScanResult): Promise<void> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(uri);
	} catch {
		return; // missing root is normal
	}
	for (const [name, type] of entries) {
		if (type !== vscode.FileType.Directory || name.startsWith(".")) {
			continue;
		}
		const dir = vscode.Uri.joinPath(uri, name);
		const file = vscode.Uri.joinPath(dir, SKILL_FILE);
		if (await exists(file)) {
			await readSkill(root, name, dir, file, path, out);
		} else if (path.length < MAX_HIERARCHY_DEPTH) {
			await scanLevel(root, dir, [...path, name], out);
		}
	}
}

async function readSkill(
	root: SkillRoot,
	name: string,
	dir: vscode.Uri,
	file: vscode.Uri,
	hierarchy: string[],
	out: ScanResult,
): Promise<void> {
	try {
		const parsed = parseSkill({
			text: await readText(file),
			dirName: name,
			dir: dir.toString(),
			scope: root.scope,
		});
		out.diagnostics.push(...parsed.diagnostics);
		if (parsed.meta) {
			out.skills.push(hierarchy.length ? { ...parsed.meta, hierarchy } : parsed.meta);
		}
	} catch (e) {
		out.diagnostics.push({
			severity: "error",
			skill: name,
			location: dir.toString(),
			message: `cannot read SKILL.md: ${e instanceof Error ? e.message : String(e)}`,
		});
	}
}

const dirUri = (meta: SkillMeta) => vscode.Uri.parse(meta.dir);

/** The Markdown body (frontmatter stripped). */
export async function loadBody(meta: SkillMeta): Promise<string> {
	const parsed = parseSkill({
		text: await readText(vscode.Uri.joinPath(dirUri(meta), SKILL_FILE)),
		dirName: meta.name,
		dir: meta.dir,
		scope: meta.scope,
	});
	return parsed.body;
}

/** Relative resource paths inside the skill dir (excluding SKILL.md), one level deep + subdirs. */
export async function listResources(meta: SkillMeta): Promise<string[]> {
	const out: string[] = [];
	const walk = async (uri: vscode.Uri, prefix: string, depth: number) => {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(uri);
		} catch {
			return;
		}
		for (const [name, type] of entries) {
			if (out.length >= MAX_RESOURCES) {
				return;
			}
			const rel = prefix ? `${prefix}/${name}` : name;
			if (type === vscode.FileType.Directory && depth < 2) {
				await walk(vscode.Uri.joinPath(uri, name), rel, depth + 1);
			} else if (type === vscode.FileType.File && rel !== SKILL_FILE) {
				out.push(rel);
			}
		}
	};
	await walk(dirUri(meta), "", 0);
	return out.sort();
}

/** Read a resource confined to the skill dir. */
export async function readResource(meta: SkillMeta, rel: string): Promise<string> {
	const safe = safeRelativePath(rel);
	if (!safe) {
		throw new Error(`invalid resource path "${rel}" (must be relative, inside the skill folder)`);
	}
	return readText(vscode.Uri.joinPath(dirUri(meta), ...safe.split("/")));
}

/** Load the block skill's struct catalog (JSON), or undefined. */
export async function loadCatalog(meta: SkillMeta): Promise<NvmStructCatalog | undefined> {
	if (!meta.struct) {
		return undefined;
	}
	const text = await readResource(meta, meta.struct);
	return parseStructCatalog(JSON.parse(text));
}
