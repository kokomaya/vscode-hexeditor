// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Block skill ↔ block matching ("Binding"). Pure and vendor-blind: every
 * condition is a glob over GENERIC block properties (name, id, identity key,
 * attribute values, layout provider string).
 */

import type { NvmBlockInfo } from "../../protocol";
import { AppliesTo, SCOPE_PRIORITY, SkillBindings, SkillMeta } from "./types";

const globCache = new Map<string, RegExp>();

/** Case-insensitive glob (`*`, `?`) → anchored RegExp (cached). */
export function globRegExp(glob: string): RegExp {
	let re = globCache.get(glob);
	if (!re) {
		const body = glob
			.split("")
			.map(c => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
			.join("");
		re = new RegExp(`^${body}$`, "i");
		if (globCache.size > 2000) {
			globCache.clear();
		}
		globCache.set(glob, re);
	}
	return re;
}

export function globMatch(glob: string, value: string | undefined): boolean {
	return value !== undefined && globRegExp(glob).test(value);
}

/** The opaque layout strings a binding may be filtered on. */
export interface LayoutContext {
	/** e.g. resolved provider id and descriptor vendor names. */
	ids: string[];
}

/** Whether a block satisfies an `appliesTo` (OR of conditions, AND layout filter). */
export function matchesAppliesTo(
	block: NvmBlockInfo,
	a: AppliesTo,
	layout?: LayoutContext,
): boolean {
	if (a.layout && a.layout !== "*") {
		if (!layout || !layout.ids.some(id => globMatch(a.layout!, id))) {
			return false;
		}
	}
	const name = block.name ?? block.id;
	if (a.blocks?.some(g => globMatch(g, name))) {
		return true;
	}
	if (
		a.ids?.some(
			g => globMatch(g, block.id) || (block.identity && globMatch(g, block.identity.key)),
		)
	) {
		return true;
	}
	if (a.attributes) {
		for (const [key, glob] of Object.entries(a.attributes)) {
			const attr = block.attributes?.find(x => x.key === key);
			if (attr && globMatch(glob, String(attr.value))) {
				return true;
			}
		}
	}
	return false;
}

/** Deterministic precedence among block skills (scope, then priority desc, then name). */
export function compareSkillPrecedence(a: SkillMeta, b: SkillMeta): number {
	return (
		SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope] ||
		b.priority - a.priority ||
		a.name.localeCompare(b.name)
	);
}

/** Compute `skill → block indices` for every enabled block skill. */
export function computeBindings(
	skills: readonly SkillMeta[],
	blocks: readonly NvmBlockInfo[],
	layout?: LayoutContext,
): SkillBindings {
	const out: SkillBindings = new Map();
	for (const s of skills) {
		if (s.kind !== "block" || !s.enabled || !s.appliesTo) {
			continue;
		}
		const hits: number[] = [];
		for (let i = 0; i < blocks.length; i++) {
			if (matchesAppliesTo(blocks[i], s.appliesTo, layout)) {
				hits.push(i);
			}
		}
		out.set(s.name, hits);
	}
	return out;
}

/** Invert bindings: block index → skills (ordered by precedence). */
export function skillsByBlock(
	bindings: SkillBindings,
	skills: readonly SkillMeta[],
): Map<number, SkillMeta[]> {
	const byName = new Map(skills.map(s => [s.name, s]));
	const out = new Map<number, SkillMeta[]>();
	for (const [name, idx] of bindings) {
		const meta = byName.get(name);
		if (!meta) {
			continue;
		}
		for (const i of idx) {
			const list = out.get(i) ?? [];
			list.push(meta);
			out.set(i, list);
		}
	}
	for (const list of out.values()) {
		list.sort(compareSkillPrecedence);
	}
	return out;
}
