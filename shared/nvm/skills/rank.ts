// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Deterministic, zero-token lexical pre-filter for skill selection
 * (skills.md §6.1). Tokenizes mixed Chinese/English text into lowercase ASCII
 * words + CJK bigrams, scores each skill's name / keywords (high weight) and
 * description (low weight), and returns the Top-K catalog. The model makes the
 * final choice; this only bounds the prompt size.
 */

import { SkillMeta } from "./types";

const CJK = /[一-鿿㐀-䶿豈-﫿]/;

/** Lowercased ASCII words (len ≥ 2) + CJK bigrams (and single CJK chars). */
export function tokenize(text: string): Set<string> {
	const out = new Set<string>();
	const lower = (text ?? "").toLowerCase();
	for (const w of lower.match(/[a-z0-9_]+/g) ?? []) {
		if (w.length >= 2) {
			out.add(w);
			// split camelCase/snake fragments are handled by the lowercase words;
			// also index sub-words of snake_case
			for (const part of w.split("_")) {
				if (part.length >= 2) {
					out.add(part);
				}
			}
		}
	}
	let run = "";
	const flush = () => {
		for (let i = 0; i < run.length; i++) {
			out.add(run[i]);
			if (i + 1 < run.length) {
				out.add(run.slice(i, i + 2));
			}
		}
		run = "";
	};
	for (const ch of lower) {
		if (CJK.test(ch)) {
			run += ch;
		} else {
			flush();
		}
	}
	flush();
	return out;
}

/** Single CJK chars are too noisy to score on their own. */
function weightOf(token: string): number {
	return token.length === 1 && CJK.test(token) ? 0 : 1;
}

function overlap(query: Set<string>, target: Set<string>): number {
	let score = 0;
	for (const t of target) {
		if (query.has(t)) {
			score += weightOf(t);
		}
	}
	return score;
}

export interface ScoredSkill {
	meta: SkillMeta;
	score: number;
}

/** Score every enabled skill against a prompt (higher = more relevant). */
export function scoreSkills(prompt: string, skills: readonly SkillMeta[]): ScoredSkill[] {
	const q = tokenize(prompt);
	const lowerPrompt = (prompt ?? "").toLowerCase();
	return skills
		.filter(s => s.enabled)
		.map(meta => {
			let score = 0;
			for (const kw of meta.keywords) {
				const k = kw.toLowerCase();
				// A whole keyword appearing verbatim is the strongest signal.
				if (k && lowerPrompt.includes(k)) {
					score += 6;
				} else {
					score += overlap(q, tokenize(k)) * 2;
				}
			}
			score += overlap(q, tokenize(meta.name.replace(/-/g, " "))) * 3;
			score += overlap(q, tokenize(meta.description));
			return { meta, score };
		})
		.sort((a, b) => b.score - a.score || b.meta.priority - a.meta.priority || a.meta.name.localeCompare(b.meta.name));
}

export interface CatalogOptions {
	/** Max skills in the catalog (default 12). */
	size?: number;
	/** Block skill → bound block count; block skills with 0 hits are omitted. */
	boundCounts?: Map<string, number>;
	/** Playbooks at or above this priority are always listed (default 10). */
	pinPriority?: number;
}

/** Choose the Top-K skills to advertise to the model for this prompt. */
export function selectCatalog(
	prompt: string,
	skills: readonly SkillMeta[],
	opts: CatalogOptions = {},
): SkillMeta[] {
	const size = Math.max(1, opts.size ?? 12);
	const pin = opts.pinPriority ?? 10;
	const eligible = skills.filter(
		s => s.enabled && (s.kind !== "block" || !opts.boundCounts || (opts.boundCounts.get(s.name) ?? 0) > 0),
	);
	if (eligible.length <= size) {
		return eligible.slice().sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
	}
	const pinned = eligible.filter(s => s.kind === "playbook" && s.priority >= pin);
	const rest = scoreSkills(prompt, eligible.filter(s => !pinned.includes(s)))
		.filter(s => s.score > 0)
		.map(s => s.meta);
	return [...pinned, ...rest].slice(0, size);
}

/**
 * Extract explicit `skill:<name>` directives from a prompt. Returns the names
 * and the prompt with the directives removed.
 */
export function parseExplicitSkills(prompt: string): { names: string[]; prompt: string } {
	const names: string[] = [];
	const cleaned = (prompt ?? "").replace(/(^|\s)skill:([a-z0-9][a-z0-9-]*)/gi, (_m, lead, n) => {
		names.push(String(n).toLowerCase());
		return lead;
	});
	return { names: [...new Set(names)], prompt: cleaned.trim() };
}
