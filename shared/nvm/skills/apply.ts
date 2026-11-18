// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Block skill → decode integration (skills.md §7). After the layout resolved
 * the blocks, bound block skills may:
 *
 * 1. DECODE: `struct` + `structRoot` decode the payload of bound blocks.
 *    Default `decodeMode: fill` — the layout config is authoritative and only
 *    blocks it left WITHOUT a decoded tree are decoded. `decodeMode: override`
 *    is an explicit per-skill opt-in that replaces the config's decode.
 * 2. DOCUMENT: `fields` meanings/units are attached to decoded nodes as `doc`,
 *    so the Data Inspector, reports and AI tools all see the same knowledge.
 *
 * Total and pure (bytes come through a reader callback). Never throws.
 */

import type { NvmBlockInfo } from "../../protocol";
import { decodeStructRich, NvmStructCatalog } from "../structRich";
import { skillsByBlock } from "./match";
import { walkPaths, wildcardPath } from "./paths";
import { SkillBindings, SkillDiagnostic, SkillMeta } from "./types";

export interface ApplyOptions {
	/** Whether skill structs may decode blocks (setting `skills.applyStructs`). */
	applyStructs: boolean;
	/** Catalog per skill name (only for skills that declared `struct`). */
	catalogs: Map<string, NvmStructCatalog>;
	/** Read `length` bytes at an editor offset (short reads allowed). */
	read?: (offset: number, length: number) => Uint8Array;
}

export interface ApplyResult {
	decoded: number;
	documented: number;
	diagnostics: SkillDiagnostic[];
}

/** Mutates `blocks` in place (fresh per parse) and reports what changed. */
export function applyBlockSkills(
	blocks: NvmBlockInfo[],
	skills: readonly SkillMeta[],
	bindings: SkillBindings,
	opts: ApplyOptions,
): ApplyResult {
	const result: ApplyResult = { decoded: 0, documented: 0, diagnostics: [] };
	const byBlock = skillsByBlock(bindings, skills);
	const conflicts = new Set<string>();
	const configWins = new Map<string, number>();
	const overridden = new Map<string, number>();

	for (const [idx, list] of byBlock) {
		const block = blocks[idx];
		if (!block) {
			continue;
		}
		if (opts.applyStructs && opts.read) {
			const decoder = list.find(s => s.struct && s.structRoot && opts.catalogs.has(s.name));
			const configDecoded = !!block.decoded?.length;
			if (decoder && configDecoded && decoder.decodeMode !== "override") {
				configWins.set(decoder.name, (configWins.get(decoder.name) ?? 0) + 1);
			} else if (decoder) {
				if (configDecoded) {
					overridden.set(decoder.name, (overridden.get(decoder.name) ?? 0) + 1);
				}
				if (decodeWith(block, decoder, opts)) {
					result.decoded++;
				}
				const others = list.filter(s => s !== decoder && s.struct);
				if (others.length) {
					conflicts.add(`${decoder.name} (used) over ${others.map(o => o.name).join(", ")}`);
				}
			}
		}
		if (block.decoded?.length && list.some(s => Object.keys(s.fields).length)) {
			result.documented += attachDocs(block, list);
		}
	}
	for (const c of conflicts) {
		result.diagnostics.push({ severity: "info", message: `struct conflict on shared blocks: ${c}` });
	}
	for (const [skill, n] of overridden) {
		result.diagnostics.push({
			severity: "warning",
			skill,
			message: `decodeMode override: replaced the layout config's decode on ${n} block(s)`,
		});
	}
	for (const [skill, n] of configWins) {
		result.diagnostics.push({
			severity: "info",
			skill,
			message: `struct not applied to ${n} block(s): the layout config already decodes them (config wins; set decodeMode: override to replace)`,
		});
	}
	return result;
}

function decodeWith(block: NvmBlockInfo, skill: SkillMeta, opts: ApplyOptions): boolean {
	const catalog = opts.catalogs.get(skill.name)!;
	const def = catalog.structs[skill.structRoot!];
	if (!def) {
		return false;
	}
	const start = block.offset + skill.payloadOffset;
	const len = Math.max(0, block.length - skill.payloadOffset);
	if (len === 0) {
		return false;
	}
	try {
		const bytes = opts.read!(start, len);
		const nodes = decodeStructRich(bytes, def, { baseOffset: start, catalog });
		if (!nodes.length) {
			return false;
		}
		block.decoded = nodes;
		return true;
	} catch {
		return false;
	}
}

/** Attach the first matching doc (by skill precedence) to each decoded node. */
function attachDocs(block: NvmBlockInfo, skills: SkillMeta[]): number {
	let n = 0;
	walkPaths(block.decoded, (node, path) => {
		if (node.doc) {
			return;
		}
		const wild = wildcardPath(path);
		for (const s of skills) {
			const doc = s.fields[path] ?? s.fields[wild] ?? (s.fields[node.name] as typeof s.fields[string] | undefined);
			if (doc && (doc.meaning || doc.unit || doc.enum)) {
				node.doc = { ...doc, source: s.name };
				n++;
				return;
			}
		}
	});
	return n;
}
