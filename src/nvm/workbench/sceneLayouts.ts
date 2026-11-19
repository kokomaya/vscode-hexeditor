// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Scenario ("scene") workbench layouts shipped by teams instead of the plugin:
 *  - workspace files `*.nvmworkbench.json` next to the dump, in `./conf` or
 *    `../conf` (the same places `*.nvmlayout.json` descriptors live);
 *  - skill folders: `<skill>/layouts/*.json`.
 * Each source implements {@link SceneLayoutSource}; adding a source never
 * touches the finder (Open/Closed). Layouts are data only (validated JSON).
 */

import * as vscode from "vscode";
import { validateLayout, WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import { SkillRegistry } from "../skills/skillRegistry";

export interface SceneLayoutSource {
	find(dumpUri: vscode.Uri): Promise<WorkbenchLayout[]>;
}

const WORKBENCH_FILE_SUFFIX = ".nvmworkbench.json";
const MAX_FILE_BYTES = 256 * 1024;

async function readLayout(uri: vscode.Uri, fallbackId: string): Promise<WorkbenchLayout | undefined> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size > MAX_FILE_BYTES) {
			return undefined;
		}
		const text = new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
		const result = validateLayout(JSON.parse(text));
		if (!result.ok) {
			console.warn(`Ignoring workbench layout ${uri.toString()}: ${result.error}`);
			return undefined;
		}
		const id = result.layout.id !== "custom" ? result.layout.id : fallbackId;
		return { ...result.layout, id: `scene.${id}` };
	} catch (e) {
		console.warn(`Ignoring workbench layout ${uri.toString()}:`, e);
		return undefined;
	}
}

async function listFiles(dir: vscode.Uri, accept: (name: string) => boolean): Promise<vscode.Uri[]> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(dir);
		return entries
			.filter(([name, type]) => type === vscode.FileType.File && accept(name.toLowerCase()))
			.map(([name]) => vscode.Uri.joinPath(dir, name));
	} catch {
		return [];
	}
}

const baseName = (uri: vscode.Uri) => uri.path.replace(/^.*\//, "");

/** `*.nvmworkbench.json` beside the dump, in ./conf and ../conf. */
export class WorkspaceSceneSource implements SceneLayoutSource {
	public async find(dumpUri: vscode.Uri): Promise<WorkbenchLayout[]> {
		const dir = vscode.Uri.joinPath(dumpUri, "..");
		const dirs = [dir, vscode.Uri.joinPath(dir, "conf"), vscode.Uri.joinPath(dir, "..", "conf")];
		const files = (await Promise.all(dirs.map(d => listFiles(d, n => n.endsWith(WORKBENCH_FILE_SUFFIX))))).flat();
		const layouts = await Promise.all(
			files.map(f => readLayout(f, baseName(f).slice(0, -WORKBENCH_FILE_SUFFIX.length))),
		);
		return layouts.filter((l): l is WorkbenchLayout => !!l);
	}
}

/** `layouts/*.json` inside every enabled skill available for the dump. */
export class SkillSceneSource implements SceneLayoutSource {
	constructor(private readonly skills: SkillRegistry) {}

	public async find(dumpUri: vscode.Uri): Promise<WorkbenchLayout[]> {
		const index = await this.skills.getIndex(dumpUri.fsPath || undefined);
		const perSkill = await Promise.all(
			index.skills
				.filter(s => s.enabled)
				.map(async s => {
					const files = await listFiles(vscode.Uri.joinPath(vscode.Uri.parse(s.dir), "layouts"), n => n.endsWith(".json"));
					return Promise.all(files.map(f => readLayout(f, `${s.name}.${baseName(f).replace(/\.json$/i, "")}`)));
				}),
		);
		return perSkill.flat().filter((l): l is WorkbenchLayout => !!l);
	}
}

/** Collects scene layouts from all sources; de-duplicates by id (first wins). */
export class SceneLayoutFinder {
	constructor(private readonly sources: readonly SceneLayoutSource[]) {}

	public async find(dumpUri: vscode.Uri): Promise<WorkbenchLayout[]> {
		const all = (await Promise.all(this.sources.map(s => s.find(dumpUri).catch(() => [])))).flat();
		const seen = new Set<string>();
		return all.filter(l => !seen.has(l.id) && !!seen.add(l.id));
	}
}
