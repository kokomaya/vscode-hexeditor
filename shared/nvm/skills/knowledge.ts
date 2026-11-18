// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Knowledge rendering + retrieval for the AI surface:
 * - {@link knowledgeSection}: the bounded `knowledge:` appendix attached to
 *   tool results that touch a bound block (skills.md §6.3);
 * - {@link searchKnowledgeText}: paragraph-level lexical search over skill
 *   bodies (`nvm_searchKnowledge`).
 */

import type { NvmBlockInfo } from "../../protocol";
import type { NvmDecodedNode } from "../structRich";
import { globMatch } from "./match";
import { nodeDisplay, nodeScalar, resolvePath, walkPaths, wildcardPath } from "./paths";
import { tokenize } from "./rank";
import { SkillMeta, ValueDocEntry } from "./types";

/** Hard cap on the appendix (§6.3). */
export const MAX_KNOWLEDGE_CHARS = 1500;

/**
 * Render the knowledge appendix for one block. `withFields=false` lists only
 * skill names (used for search results).
 */
export function knowledgeSection(
	block: NvmBlockInfo,
	skills: readonly SkillMeta[],
	withFields = true,
	max = MAX_KNOWLEDGE_CHARS,
): string {
	if (!skills.length) {
		return "";
	}
	const lines: string[] = ["knowledge:"];
	for (const s of skills) {
		lines.push(`  skill: ${s.name} — ${s.description} (call nvm_useSkill for full guidance)`);
	}
	if (withFields && block.decoded?.length) {
		// Per-value routes first: they tell the AI exactly which document explains THIS value.
		for (const s of skills) {
			for (const r of resolveValueDocs(block, s)) {
				const how = r.doc.startsWith("skill:")
					? `nvm_useSkill("${r.doc.slice(6)}")`
					: `nvm_readSkillResource("${s.name}", "${r.doc}")`;
				lines.push(`  ${r.path} = ${r.display} → explained by ${how}`);
			}
		}
		// Array elements sharing one wildcard doc collapse into a single line.
		const grouped = new Map<string, { values: string[]; meaning: string; unit?: string }>();
		walkPaths(block.decoded, (node, path) => {
			if (!node.doc?.meaning || node.children?.length) {
				return;
			}
			const key = wildcardPath(path);
			const g = grouped.get(key);
			if (g) {
				g.values.push(nodeDisplay(node));
			} else {
				grouped.set(key, { values: [nodeDisplay(node)], meaning: node.doc.meaning, unit: node.doc.unit });
			}
		});
		for (const [key, g] of grouped) {
			const unit = g.unit ? ` [${g.unit}]` : "";
			const value = g.values.length > 1 ? `[${g.values.slice(0, 16).join(", ")}${g.values.length > 16 ? ", …" : ""}]` : g.values[0];
			lines.push(`  ${key} = ${value} — ${g.meaning}${unit}`);
		}
	}
	let text = lines.join("\n");
	if (text.length > max) {
		text = `${text.slice(0, max - 20)}\n  … (truncated)`;
	}
	return text;
}

export interface ResolvedValueDoc {
	path: string;
	display: string;
	doc: string;
}

/** First matching route for a node (glob over its enum label, then its value text). */
export function matchValueDoc(node: NvmDecodedNode, routes: readonly ValueDocEntry[]): ValueDocEntry | undefined {
	const label = node.enumLabel;
	const value = nodeScalar(node);
	const texts = [label, value === undefined ? undefined : String(value)].filter((x): x is string => !!x);
	return routes.find(r => texts.some(t => globMatch(r.match, t)));
}

/** Resolve a skill's `valueDocs` against a block's decoded values (≤ 8 per path). */
export function resolveValueDocs(block: NvmBlockInfo, skill: SkillMeta): ResolvedValueDoc[] {
	const out: ResolvedValueDoc[] = [];
	for (const [path, routes] of Object.entries(skill.valueDocs)) {
		for (const node of resolvePath(block.decoded, path).slice(0, 8)) {
			const hit = matchValueDoc(node, routes);
			if (hit) {
				out.push({ path, display: nodeDisplay(node), doc: hit.doc });
			}
		}
	}
	return out;
}

export interface KnowledgeDoc {
	meta: SkillMeta;
	body: string;
}

export interface KnowledgeHit {
	skill: string;
	kind: string;
	score: number;
	/** The best-matching paragraph (≤ maxChars). */
	excerpt: string;
}

/** Split Markdown into paragraphs, keeping the nearest heading as context. */
function paragraphs(body: string): string[] {
	const out: string[] = [];
	let heading = "";
	for (const chunk of body.split(/\n\s*\n/)) {
		const t = chunk.trim();
		if (!t) {
			continue;
		}
		const h = /^#{1,6}\s+(.*)$/m.exec(t);
		if (h && t.split("\n").length === 1) {
			heading = h[1];
			continue;
		}
		out.push(heading ? `[${heading}] ${t}` : t);
	}
	return out;
}

/** Lexical paragraph search across skills (metadata + body). */
export function searchKnowledgeText(
	query: string,
	docs: readonly KnowledgeDoc[],
	limit = 10,
	maxChars = 600,
): KnowledgeHit[] {
	const q = tokenize(query);
	if (q.size === 0) {
		return [];
	}
	const score = (text: string) => {
		let s = 0;
		for (const t of tokenize(text)) {
			// Single CJK chars are too noisy to count on their own.
			if (q.has(t) && !(t.length === 1 && t.charCodeAt(0) > 0x7f)) {
				s++;
			}
		}
		return s;
	};
	const hits: KnowledgeHit[] = [];
	for (const d of docs) {
		const metaText = `${d.meta.name} ${d.meta.keywords.join(" ")} ${d.meta.description}`;
		const metaScore = score(metaText) * 2;
		let best = { s: 0, text: d.meta.description };
		for (const p of paragraphs(d.body)) {
			const s = score(p);
			if (s > best.s) {
				best = { s, text: p };
			}
		}
		const total = metaScore + best.s;
		if (total > 0) {
			hits.push({
				skill: d.meta.name,
				kind: d.meta.kind,
				score: total,
				excerpt: best.text.length > maxChars ? `${best.text.slice(0, maxChars - 1)}…` : best.text,
			});
		}
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(limit, 10));
}
