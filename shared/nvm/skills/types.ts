// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * NVM Studio **Skills** — vendor-free data model (docs/features/skills.md).
 *
 * A skill is pure data (a `SKILL.md` with frontmatter + Markdown body, plus
 * optional resource files). The core only knows the generic notions defined
 * here: a kind, keywords, block-match rules over generic block properties,
 * an optional `NvmStructDef` catalog, and declarative rules / relations
 * evaluated by the whitelisted predicate evaluator. It never knows any vendor,
 * block name or business meaning — those live in the skill files themselves.
 */

import type { NvmStructCatalog } from "../structRich";

/** `playbook` = "how to investigate"; `block` = "what this block is". */
export type SkillKind = "playbook" | "block";

/** Where a skill came from — also its override priority (lower index wins). */
export type SkillScope = "setting" | "descriptor" | "workspace" | "user" | "builtin";

/** Search-root priority: lower = higher priority. */
export const SCOPE_PRIORITY: Record<SkillScope, number> = {
	setting: 0,
	descriptor: 1,
	workspace: 2,
	user: 3,
	builtin: 4,
};

/**
 * Block-match rules. Conditions are OR-ed with each other, and the values
 * inside one condition are OR-ed too. All matching is over GENERIC block
 * properties (name / id / identity / attributes / provider string).
 */
export interface AppliesTo {
	/** Block name globs (case-insensitive; `*` and `?`). */
	blocks?: string[];
	/** Block ids or identity keys (exact, case-insensitive; or globs). */
	ids?: string[];
	/** Attribute key → value glob. */
	attributes?: Record<string, string>;
	/**
	 * Restrict to a layout provider/descriptor (opaque string glob, e.g. the
	 * provider id or descriptor vendor). This is a FILTER, AND-ed with the rest.
	 */
	layout?: string;
}

/** Field documentation keyed by decoded path (`a.b`, `arr[]`, `arr[3].x`). */
export interface SkillFieldDoc {
	meaning?: string;
	unit?: string;
	enum?: string;
}

/** One `valueDocs` route: values matching `match` are explained by `doc`. */
export interface ValueDocEntry {
	/** Glob over the enum label or value text (e.g. `FS_RESET_ECC_*`, `16394`). */
	match: string;
	/** Skill-relative resource path, or `skill:<name>` to point at another skill. */
	doc: string;
}

/** Severity of a rule / relation finding. */
export type RuleSeverity = "info" | "warning" | "error";

/**
 * A single-block invariant evaluated over the decoded tree of every bound
 * block (e.g. `Counter >= HistoryIdx`). A rule PASSES when `expr` is truthy.
 */
export interface SkillRule {
	id: string;
	expr: string;
	severity?: RuleSeverity;
	message?: string;
	/** Evaluate on every version (`all`) or only the newest instance (`latest`, default). */
	scope?: "latest" | "all";
}

/**
 * Relation kinds — the generic vocabulary for cross-block analysis:
 * - `order`:     write-order constraint between this block and `with`
 *                (`expect: before | after | together`, optionally `within` N sequence steps).
 * - `value`:     cross-block predicate (`expr` may use `self.X` and `other.Y`).
 * - `presence`:  `with` must exist (or must NOT exist with `expect: absent`) when this block exists.
 * - `cowrite`:   this block and `with` are expected to be written in the same burst
 *                (sequence distance ≤ `within`, default 3).
 * - `reference`: a field of this block (`field`) must equal the id/identity/offset of a `with` block.
 */
export type RelationKind = "order" | "value" | "presence" | "cowrite" | "reference";

export interface SkillRelation {
	id: string;
	kind: RelationKind;
	/** Partner block name glob. */
	with: string;
	expect?: "before" | "after" | "together" | "present" | "absent";
	/** Max sequence distance for `order`/`cowrite`. */
	within?: number;
	/** Predicate for `value` relations (`self.*`, `other.*`). */
	expr?: string;
	/** Field path (on self) for `reference` relations. */
	field?: string;
	severity?: RuleSeverity;
	message?: string;
	/** Free-text business meaning shown to the AI with the finding. */
	meaning?: string;
}

/** Parsed frontmatter + location of one skill (the Skill Index entry). */
export interface SkillMeta {
	name: string;
	kind: SkillKind;
	description: string;
	keywords: string[];
	priority: number;
	enabled: boolean;
	/** Playbook: suggested tool names (hint only). */
	tools: string[];
	/** Composition: other skills this one builds on (loaded together by useSkill). */
	uses: string[];
	/** Block skill: match rules. */
	appliesTo?: AppliesTo;
	/**
	 * Block skill: OPTIONAL fallback catalog file (relative to the skill dir). The
	 * layout config is authoritative: this struct only decodes bound blocks the
	 * config/engine left undecoded, and is never fed into the engine.
	 */
	struct?: string;
	/** Block skill: root struct inside the fallback catalog. */
	structRoot?: string;
	/**
	 * Block skill: how the fallback `struct` interacts with the layout config.
	 * `fill` (DEFAULT, config wins): only decode blocks the config left undecoded.
	 * `override` (explicit opt-in): replace the config's decode on bound blocks —
	 * use only to correct a known-wrong config decode; it is logged per dump.
	 */
	decodeMode: "fill" | "override";
	/** Block skill: payload starts this many bytes into the block (default 0). */
	payloadOffset: number;
	/**
	 * Named constants usable in this skill's rules / relations (e.g. project
	 * config values like a block count). Take precedence over field names, so
	 * use UPPER_CASE names.
	 */
	params: Record<string, number | string | boolean>;
	fields: Record<string, SkillFieldDoc>;
	/**
	 * Per-VALUE documentation index: field path → ordered `{ match, doc }` where
	 * `match` is a glob over the field's enum label (or value text) and `doc` is a
	 * skill-relative resource path or `skill:<name>`. Lets ONE block skill route
	 * each value (e.g. every reason code) to its own document / playbook.
	 */
	valueDocs: Record<string, ValueDocEntry[]>;
	rules: SkillRule[];
	relations: SkillRelation[];
	/** Where it was found. */
	scope: SkillScope;
	/** Turned off by the user (`nvmstudio.nvm.skills.disabled`); `enabled` is then false. */
	disabledByUser?: boolean;
	/**
	 * Folder levels above the skill inside its root (product / platform /
	 * project, see `hierarchy.ts`); empty or absent = general.
	 */
	hierarchy?: string[];
	/** Directory of the skill (opaque location string, e.g. a URI). */
	dir: string;
	/** Markdown body offset is not stored; the body is loaded lazily. */
}

/** A loaded, ready-to-use skill (body + catalog resolved on demand). */
export interface LoadedSkill {
	meta: SkillMeta;
	body: string;
	resources: string[];
	catalog?: NvmStructCatalog;
}

/** One problem found while indexing skills. */
export interface SkillDiagnostic {
	severity: "info" | "warning" | "error";
	skill?: string;
	location?: string;
	message: string;
}

/** Binding result: skill name → indices of matching blocks (into the block array). */
export type SkillBindings = Map<string, number[]>;
