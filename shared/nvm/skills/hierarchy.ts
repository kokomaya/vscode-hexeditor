// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Skill hierarchy: product → platform → project, expressed purely by folders.
 *
 *   <root>/<skill>/SKILL.md                               general
 *   <root>/<product>/<skill>/SKILL.md                      product   (e.g. radar)
 *   <root>/<product>/<platform>/<skill>/SKILL.md           platform  (chip platform / variant)
 *   <root>/<product>/<platform>/<project>/<skill>/SKILL.md project   (customer application)
 *
 * A folder holding `SKILL.md` is a skill; any other folder is a level. Names
 * only need to be unique inside one folder. A dump is analysed in a *context*
 * (`radar/chipA/customerB`, or a prefix of it): the skills of that folder and
 * of every ancestor are visible; on a name clash the nearest (most specific)
 * level wins. The hierarchy is organisation only — whether a skill applies to
 * a block is still decided by its `appliesTo`.
 */

export const HIERARCHY_LEVELS = ["product", "platform", "project"] as const;
export type HierarchyLevel = "general" | (typeof HIERARCHY_LEVELS)[number];
export const MAX_HIERARCHY_DEPTH = HIERARCHY_LEVELS.length;

/** A folder name usable as a level (any non-hidden name; no separators or control characters). */
export const isLevelName = (s: unknown): s is string =>
	typeof s === "string" &&
	s.trim() === s &&
	s !== "" &&
	!s.startsWith(".") &&
	!/[\\/:*?"<>|]/.test(s) &&
	![...s].some(c => c.charCodeAt(0) < 0x20);

/** Parse `radar/chipA/customerB` (or `[]`-like empty) into segments; undefined when invalid. */
export function parseHierarchyPath(input: unknown): string[] | undefined {
	if (input === undefined || input === null || input === "") {
		return [];
	}
	if (typeof input !== "string" && !Array.isArray(input)) {
		return undefined;
	}
	const parts = (typeof input === "string" ? input.split(/[\\/]+/) : input).filter(p => p !== "");
	return parts.length <= MAX_HIERARCHY_DEPTH && parts.every(isLevelName) ? (parts as string[]) : undefined;
}

export const formatHierarchyPath = (path: readonly string[]) => path.join("/");

export function levelOf(path: readonly string[]): HierarchyLevel {
	return path.length === 0 ? "general" : HIERARCHY_LEVELS[path.length - 1];
}

/** A skill at `skillPath` is visible in `context` when its folder is the context or an ancestor of it. */
export function visibleIn(skillPath: readonly string[], context: readonly string[]): boolean {
	return skillPath.length <= context.length && skillPath.every((s, i) => s === context[i]);
}

/**
 * Keep the skills visible in `context` and, per name, only the nearest one.
 * Input order is preserved among the winners.
 */
export function resolveHierarchy<T extends { name: string; hierarchy?: readonly string[] }>(
	skills: readonly T[],
	context: readonly string[],
): { visible: T[]; shadowed: { skill: T; by: T }[] } {
	const best = new Map<string, T>();
	const shadowed: { skill: T; by: T }[] = [];
	for (const s of skills) {
		const path = s.hierarchy ?? [];
		if (!visibleIn(path, context)) {
			continue;
		}
		const prev = best.get(s.name);
		if (!prev) {
			best.set(s.name, s);
		} else if (path.length > (prev.hierarchy ?? []).length) {
			shadowed.push({ skill: prev, by: s });
			best.set(s.name, s);
		} else {
			shadowed.push({ skill: s, by: prev });
		}
	}
	const winners = new Set(best.values());
	return { visible: skills.filter(s => winners.has(s)), shadowed };
}

/** Every level folder that holds skills (and its ancestors), for a context picker. */
export function hierarchyContexts(paths: readonly (readonly string[])[]): string[][] {
	const seen = new Map<string, string[]>();
	for (const p of paths) {
		for (let i = 1; i <= p.length; i++) {
			const prefix = p.slice(0, i);
			seen.set(formatHierarchyPath(prefix), prefix);
		}
	}
	return [...seen.values()].sort((a, b) => formatHierarchyPath(a).localeCompare(formatHierarchyPath(b)));
}
