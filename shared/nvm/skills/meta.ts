// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Turn parsed frontmatter into a validated {@link SkillMeta}. Lenient where it
 * is safe (unknown keys ignored, scalars coerced to lists) and strict where a
 * mistake would silently change behaviour (missing name/kind/description,
 * block skill without `appliesTo`). Pure: no I/O.
 */

import { parseYamlSubset, splitFrontmatter, YamlValue } from "./frontmatter";
import {
	AppliesTo,
	RelationKind,
	RuleSeverity,
	SkillDiagnostic,
	SkillFieldDoc,
	SkillKind,
	SkillMeta,
	SkillRelation,
	SkillRule,
	SkillScope,
	ValueDocEntry,
} from "./types";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_DESCRIPTION = 300;
const RELATION_KINDS: RelationKind[] = ["order", "value", "presence", "cowrite", "reference"];

export interface SkillSource {
	/** Full `SKILL.md` text. */
	text: string;
	/** Directory name (default skill name). */
	dirName: string;
	/** Opaque directory location. */
	dir: string;
	scope: SkillScope;
}

export interface ParsedSkill {
	meta?: SkillMeta;
	body: string;
	diagnostics: SkillDiagnostic[];
}

type Obj = { [k: string]: YamlValue };

const isObj = (v: YamlValue | undefined): v is Obj =>
	!!v && typeof v === "object" && !Array.isArray(v);

function str(v: YamlValue | undefined): string | undefined {
	if (v === null || v === undefined) {
		return undefined;
	}
	return typeof v === "object" ? undefined : String(v).trim();
}

function strList(v: YamlValue | undefined): string[] {
	if (v === null || v === undefined) {
		return [];
	}
	const arr = Array.isArray(v) ? v : [v];
	return arr.map(x => str(x)).filter((x): x is string => !!x);
}

function num(v: YamlValue | undefined, dflt: number): number {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isFinite(n) ? n : dflt;
}

function severity(v: YamlValue | undefined): RuleSeverity {
	const s = str(v);
	return s === "error" || s === "info" ? s : "warning";
}

/** Parse + validate one `SKILL.md`. Never throws. */
export function parseSkill(src: SkillSource): ParsedSkill {
	const diagnostics: SkillDiagnostic[] = [];
	const diag = (severity: SkillDiagnostic["severity"], message: string, skill?: string) =>
		diagnostics.push({ severity, message, skill, location: src.dir });

	let raw: Obj;
	let body: string;
	try {
		const split = splitFrontmatter(src.text);
		if (split.frontmatter === undefined) {
			diag("error", "SKILL.md has no '---' frontmatter block", src.dirName);
			return { body: split.body, diagnostics };
		}
		raw = parseYamlSubset(split.frontmatter, 2);
		body = split.body.trim();
	} catch (e) {
		diag("error", `frontmatter: ${e instanceof Error ? e.message : String(e)}`, src.dirName);
		return { body: "", diagnostics };
	}

	const name = str(raw.name) ?? src.dirName.toLowerCase();
	if (!NAME_RE.test(name)) {
		diag("error", `invalid name "${name}" (use [a-z0-9-])`, name);
		return { body, diagnostics };
	}
	const kindStr = str(raw.kind);
	if (kindStr !== "playbook" && kindStr !== "block") {
		diag("error", `kind must be "playbook" or "block" (got "${kindStr ?? ""}")`, name);
		return { body, diagnostics };
	}
	const kind: SkillKind = kindStr;
	let description = str(raw.description) ?? "";
	if (!description) {
		diag("error", "description is required (it is how the AI decides to use the skill)", name);
		return { body, diagnostics };
	}
	if (description.length > MAX_DESCRIPTION) {
		diag("warning", `description longer than ${MAX_DESCRIPTION} chars — truncated`, name);
		description = description.slice(0, MAX_DESCRIPTION);
	}

	const meta: SkillMeta = {
		name,
		kind,
		description,
		keywords: strList(raw.keywords),
		priority: num(raw.priority, 0),
		enabled: raw.enabled !== false,
		tools: strList(raw.tools),
		uses: strList(raw.uses).filter(u => u !== name),
		decodeMode: str(raw.decodeMode) === "override" ? "override" : "fill",
		payloadOffset: Math.max(0, Math.floor(num(raw.payloadOffset, 0))),
		params: parseParams(raw.params),
		fields: {},
		valueDocs: {},
		rules: [],
		relations: [],
		scope: src.scope,
		dir: src.dir,
	};

	const dm = str(raw.decodeMode);
	if (dm && dm !== "fill" && dm !== "override") {
		diag("warning", `decodeMode must be "fill" (default) or "override" — got "${dm}", using "fill"`, name);
	}
	meta.valueDocs = parseValueDocs(raw.valueDocs, m => diag("warning", m, name));

	if (kind === "block") {
		meta.appliesTo = parseAppliesTo(raw.appliesTo);
		if (!meta.appliesTo) {
			diag("error", "block skill requires an 'appliesTo' with blocks/ids/attributes", name);
			return { body, diagnostics };
		}
		meta.struct = str(raw.struct);
		meta.structRoot = str(raw.structRoot);
		if (meta.struct && !meta.structRoot) {
			diag("warning", "'struct' given without 'structRoot' — the catalog will not decode blocks", name);
		}
		meta.fields = parseFields(raw.fields);
	}
	meta.rules = parseRules(raw.rules, m => diag("warning", m, name));
	meta.relations = parseRelations(raw.relations, m => diag("warning", m, name));
	return { meta, body, diagnostics };
}

function parseAppliesTo(v: YamlValue | undefined): AppliesTo | undefined {
	if (!isObj(v)) {
		return undefined;
	}
	const a: AppliesTo = {
		blocks: strList(v.blocks),
		ids: strList(v.ids),
		layout: str(v.layout),
	};
	if (isObj(v.attributes)) {
		a.attributes = {};
		for (const [k, val] of Object.entries(v.attributes)) {
			const s = str(val);
			if (s !== undefined) {
				a.attributes[k] = s;
			}
		}
	}
	const any =
		(a.blocks?.length ?? 0) + (a.ids?.length ?? 0) + Object.keys(a.attributes ?? {}).length;
	return any > 0 ? a : undefined;
}

function parseFields(v: YamlValue | undefined): Record<string, SkillFieldDoc> {
	const out: Record<string, SkillFieldDoc> = {};
	if (!isObj(v)) {
		return out;
	}
	for (const [path, doc] of Object.entries(v)) {
		if (typeof doc === "string") {
			out[path] = { meaning: doc };
		} else if (isObj(doc)) {
			out[path] = { meaning: str(doc.meaning), unit: str(doc.unit), enum: str(doc.enum) };
		}
	}
	return out;
}

/** `params: { NAME: 3, MODE: "x" }` → named scalar constants for expressions. */
function parseParams(v: YamlValue | undefined): Record<string, number | string | boolean> {
	const out: Record<string, number | string | boolean> = {};
	if (!isObj(v)) {
		return out;
	}
	for (const [k, val] of Object.entries(v)) {
		if (/^[A-Za-z_$][\w$]*$/.test(k) && (typeof val === "number" || typeof val === "string" || typeof val === "boolean")) {
			out[k] = val;
		}
	}
	return out;
}

/** A skill-relative resource path (no `..`, not absolute), or undefined. */
export function safeRelativePath(rel: string): string | undefined {
	const p = (rel ?? "").replace(/\\/g, "/").trim();
	if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\0")) {
		return undefined;
	}
	const parts: string[] = [];
	for (const seg of p.split("/")) {
		if (seg === "" || seg === ".") {
			continue;
		}
		if (seg === "..") {
			return undefined;
		}
		parts.push(seg);
	}
	return parts.length ? parts.join("/") : undefined;
}

/**
 * `valueDocs: { <path>: { "<glob>": "<resource|skill:name>", … } }` — map order
 * is kept, so put specific globs before broad ones (first match wins).
 */
function parseValueDocs(
	v: YamlValue | undefined,
	warn: (m: string) => void,
): Record<string, ValueDocEntry[]> {
	const out: Record<string, ValueDocEntry[]> = {};
	if (!isObj(v)) {
		return out;
	}
	for (const [path, routes] of Object.entries(v)) {
		if (!isObj(routes)) {
			warn(`valueDocs.${path} must be a map of "<glob>": "<doc>"`);
			continue;
		}
		const list: ValueDocEntry[] = [];
		for (const [match, target] of Object.entries(routes)) {
			const doc = str(target);
			if (!doc) {
				continue;
			}
			if (!doc.startsWith("skill:") && !safeRelativePath(doc)) {
				warn(`valueDocs.${path}["${match}"]: "${doc}" must be a relative path inside the skill or skill:<name>`);
				continue;
			}
			list.push({ match, doc });
		}
		if (list.length) {
			out[path] = list;
		}
	}
	return out;
}

function parseRules(v: YamlValue | undefined, warn: (m: string) => void): SkillRule[] {
	if (!Array.isArray(v)) {
		return [];
	}
	const out: SkillRule[] = [];
	v.forEach((r, i) => {
		if (!isObj(r) || !str(r.expr)) {
			warn(`rules[${i}] needs an 'expr'`);
			return;
		}
		out.push({
			id: str(r.id) ?? `rule-${i + 1}`,
			expr: str(r.expr)!,
			severity: severity(r.severity),
			message: str(r.message),
			scope: str(r.scope) === "all" ? "all" : "latest",
		});
	});
	return out;
}

function parseRelations(v: YamlValue | undefined, warn: (m: string) => void): SkillRelation[] {
	if (!Array.isArray(v)) {
		return [];
	}
	const out: SkillRelation[] = [];
	v.forEach((r, i) => {
		if (!isObj(r)) {
			warn(`relations[${i}] must be a map`);
			return;
		}
		const kind = str(r.kind) as RelationKind;
		const withGlob = str(r.with);
		if (!RELATION_KINDS.includes(kind) || !withGlob) {
			warn(`relations[${i}] needs kind (${RELATION_KINDS.join("|")}) and 'with'`);
			return;
		}
		if (kind === "value" && !str(r.expr)) {
			warn(`relations[${i}] (value) needs an 'expr'`);
			return;
		}
		if (kind === "reference" && !str(r.field)) {
			warn(`relations[${i}] (reference) needs a 'field'`);
			return;
		}
		const expect = str(r.expect) as SkillRelation["expect"];
		const within = r.within === undefined ? undefined : num(r.within, NaN);
		out.push({
			id: str(r.id) ?? `relation-${i + 1}`,
			kind,
			with: withGlob,
			expect,
			within: Number.isFinite(within) ? within : undefined,
			expr: str(r.expr),
			field: str(r.field),
			severity: severity(r.severity),
			message: str(r.message),
			meaning: str(r.meaning),
		});
	});
	return out;
}
