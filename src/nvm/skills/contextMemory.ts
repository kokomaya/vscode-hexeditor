// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * What the skill-context pickers can offer besides the level folders found on
 * disk: the configured context, recently used ones and the levels the install
 * server announced last time (cached, so they survive going offline). Without
 * this, a project whose skills all live at product level has no local folder
 * and disappears from the picker as soon as another context is selected.
 *
 * Also remembers the server version of each installed skill (local SKILL.md
 * folders carry no version) so the Resources panel can offer updates.
 */

import * as vscode from "vscode";
import { formatHierarchyPath, hierarchyContexts, parseHierarchyPath } from "../../../shared/nvm/skills/hierarchy";
import { RemoteLevel, RemoteSkill } from "../../../shared/nvm/skills/remoteSkills";

const RECENT_KEY = "nvmStudio.skills.recentContexts";
const LEVELS_KEY = "nvmStudio.skills.serverLevels";
const VERSIONS_KEY = "nvmStudio.skills.installedVersions";
const MAX_RECENT = 10;

let memento: vscode.Memento | undefined;

export function initContextMemory(state: vscode.Memento): void {
	memento = state;
}

export const recentContexts = (): string[] => memento?.get<string[]>(RECENT_KEY, []) ?? [];

export function rememberContext(key: string): void {
	if (memento && key) {
		void memento.update(RECENT_KEY, [key, ...recentContexts().filter(k => k !== key)].slice(0, MAX_RECENT));
	}
}

interface CachedLevel {
	path: string[];
	title: string;
}

export const serverLevels = (): CachedLevel[] => memento?.get<CachedLevel[]>(LEVELS_KEY, []) ?? [];

/** Cache the server's level folders (paths of levels and of every skill's parents). */
export function rememberServerLevels(levels: readonly RemoteLevel[], skills: readonly RemoteSkill[] = []): void {
	if (!memento || (!levels.length && !skills.length)) {
		return;
	}
	const titles = new Map(levels.map(l => [formatHierarchyPath(l.path), l.title]));
	const paths = hierarchyContexts([...levels.map(l => l.path), ...skills.map(s => s.path)]);
	void memento.update(
		LEVELS_KEY,
		paths.map(path => ({ path, title: titles.get(formatHierarchyPath(path)) ?? path[path.length - 1] })),
	);
}

export const installedSkillVersion = (id: string): string | undefined =>
	memento?.get<Record<string, string>>(VERSIONS_KEY, {})?.[id];

export function rememberSkillVersions(skills: readonly RemoteSkill[]): void {
	if (!memento) {
		return;
	}
	const map = { ...(memento.get<Record<string, string>>(VERSIONS_KEY, {}) ?? {}) };
	for (const s of skills) {
		if (s.version) {
			map[s.id] = s.version;
		} else {
			delete map[s.id];
		}
	}
	void memento.update(VERSIONS_KEY, map);
}

export function forgetSkillVersion(id: string): void {
	if (memento) {
		const map = { ...(memento.get<Record<string, string>>(VERSIONS_KEY, {}) ?? {}) };
		delete map[id];
		void memento.update(VERSIONS_KEY, map);
	}
}

export interface ContextCandidate {
	path: string[];
	key: string;
	/** Display path using server level titles ("雷达 Radar › chipA › customerB"). */
	title: string;
	/** A local folder at this level holds skills. */
	local: boolean;
	/** The install server announced this level (last known). */
	remote: boolean;
	recent: boolean;
}

/** Every context worth offering: local folders ∪ server levels ∪ recent ∪ `current` (with ancestors). */
export function contextCandidates(local: readonly (readonly string[])[], current: readonly string[]): ContextCandidate[] {
	const levels = serverLevels();
	const titles = new Map(levels.map(l => [formatHierarchyPath(l.path), l.title]));
	const recent = recentContexts().map(k => parseHierarchyPath(k)).filter((p): p is string[] => !!p?.length);
	const keys = (paths: readonly (readonly string[])[]) => new Set(hierarchyContexts(paths).map(formatHierarchyPath));
	const localKeys = keys(local);
	const remoteKeys = keys(levels.map(l => l.path));
	const recentKeys = new Set(recent.map(formatHierarchyPath));
	const all = hierarchyContexts([...local, ...levels.map(l => l.path), ...recent, ...(current.length ? [current] : [])]);
	return all.map(path => {
		const key = formatHierarchyPath(path);
		return {
			path,
			key,
			title: path.map((seg, i) => titles.get(formatHierarchyPath(path.slice(0, i + 1))) ?? seg).join(" › "),
			local: localKeys.has(key),
			remote: remoteKeys.has(key),
			recent: recentKeys.has(key),
		};
	});
}
