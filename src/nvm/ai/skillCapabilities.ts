// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Skill facade for the AI surfaces (skills.md §8). Owns every limit on how
 * much skill text leaves the host. Works with or without an active dump: with
 * a dump, block skills report their bindings; without, only metadata.
 */

import * as vscode from "vscode";
import { NvmBlockInfo } from "../../../shared/protocol";
import { knowledgeSection, KnowledgeHit, searchKnowledgeText } from "../../../shared/nvm/skills/knowledge";
import { scoreSkills, selectCatalog } from "../../../shared/nvm/skills/rank";
import { checkSkills, CheckSummary } from "../../../shared/nvm/skills/rules";
import { SkillBindings, SkillDiagnostic, SkillKind, SkillMeta } from "../../../shared/nvm/skills/types";
import { readResource } from "../skills/skillLoader";
import { SkillIndex, SkillRegistry } from "../skills/skillRegistry";
import { ActiveDump } from "./activeDump";
import { NvmCapabilityError, Page, toPage } from "./capabilityTypes";

const MAX_BODY = 8000;
const MAX_RESOURCE = 8000;
const MAX_BOUND = 50;
const MAX_LIST = 100;

export type SkillsMode = "auto" | "manual" | "off";

export interface SkillSummary {
	name: string;
	kind: SkillKind;
	description: string;
	scope: string;
	/** Block skill: number of blocks bound in the active dump (undefined = no dump). */
	boundBlocks?: number;
	uses: string[];
	rules: number;
	relations: number;
	hasStruct: boolean;
}

export interface SkillActivation extends SkillSummary {
	body: string;
	bodyTruncated: boolean;
	resources: string[];
	tools: string[];
	boundBlockNames: string[];
	boundTruncated: boolean;
	/** Summaries of the skills this one composes (`uses`). */
	composed: SkillSummary[];
	fields: { path: string; meaning?: string; unit?: string }[];
	/** Per-value document routes (`valueDocs`): path → glob → doc. */
	valueDocs: { path: string; match: string; doc: string }[];
}

interface Ctx {
	index: SkillIndex;
	blocks?: NvmBlockInfo[];
	bindings?: SkillBindings;
}

export function skillsMode(): SkillsMode {
	const m = vscode.workspace.getConfiguration("nvmstudio").get<string>("nvm.skills.mode", "auto");
	return m === "manual" || m === "off" ? m : "auto";
}

export class SkillCapabilities {
	constructor(
		private readonly dump: ActiveDump,
		private readonly registry?: SkillRegistry,
	) {}

	/** Skills can be used at all (registry present and not switched off). */
	public get available(): boolean {
		return !!this.registry && skillsMode() !== "off";
	}

	private reg(): SkillRegistry {
		if (!this.registry || skillsMode() === "off") {
			throw new NvmCapabilityError("NVM skills are disabled (setting nvmstudio.nvm.skills.mode = off).");
		}
		return this.registry;
	}

	/** Index for the active dump (+ bindings when a dump with blocks is open). */
	private async ctx(): Promise<Ctx> {
		const reg = this.reg();
		let doc: ReturnType<ActiveDump["doc"]> | undefined;
		try {
			doc = this.dump.doc();
		} catch {
			doc = undefined;
		}
		const index = await reg.getIndex(doc?.uri.fsPath);
		if (!doc) {
			return { index };
		}
		const blocks = this.dump.blocks();
		const bindings = reg.bindings(blocks, index.skills, reg.layoutContext(doc.uri));
		return { index, blocks, bindings };
	}

	private summary(s: SkillMeta, c: Ctx): SkillSummary {
		return {
			name: s.name,
			kind: s.kind,
			description: s.description,
			scope: s.scope,
			boundBlocks: s.kind === "block" && c.bindings ? (c.bindings.get(s.name)?.length ?? 0) : undefined,
			uses: s.uses,
			rules: s.rules.length,
			relations: s.relations.length,
			hasStruct: !!s.struct,
		};
	}

	private byName(c: Ctx, name: string): SkillMeta {
		const n = (name ?? "").trim().toLowerCase().replace(/^skill:/, "");
		const s = c.index.skills.find(x => x.name === n);
		if (!s) {
			const near = scoreSkills(n, c.index.skills).slice(0, 3).map(x => x.meta.name);
			throw new NvmCapabilityError(`No skill named "${name}".${near.length ? ` Did you mean: ${near.join(", ")}?` : ""}`);
		}
		return s;
	}

	/** List skills (optionally filtered by kind / query), with binding counts. */
	public async listSkills(opts: { kind?: string; query?: string; limit?: number; offset?: number } = {}): Promise<Page<SkillSummary>> {
		const c = await this.ctx();
		let skills = c.index.skills.filter(s => s.enabled);
		if (opts.kind === "playbook" || opts.kind === "block") {
			skills = skills.filter(s => s.kind === opts.kind);
		}
		if (opts.query?.trim()) {
			skills = scoreSkills(opts.query, skills)
				.filter(x => x.score > 0)
				.map(x => x.meta);
		} else {
			skills = skills.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
		}
		return toPage(skills.map(s => this.summary(s, c)), opts.offset, opts.limit ?? MAX_LIST, MAX_LIST);
	}

	/** Activate a skill: body (capped), resources, bound blocks, composed skills. */
	public async useSkill(name: string): Promise<SkillActivation> {
		const c = await this.ctx();
		const meta = this.byName(c, name);
		const loaded = await this.reg().load(meta);
		const idx = c.bindings?.get(meta.name) ?? [];
		const names = idx.slice(0, MAX_BOUND).map(i => c.blocks![i].name ?? c.blocks![i].id);
		const composed = meta.uses
			.map(u => c.index.skills.find(s => s.name === u))
			.filter((s): s is SkillMeta => !!s)
			.map(s => this.summary(s, c));
		return {
			...this.summary(meta, c),
			body: loaded.body.slice(0, MAX_BODY),
			bodyTruncated: loaded.body.length > MAX_BODY,
			resources: loaded.resources,
			tools: meta.tools,
			boundBlockNames: names,
			boundTruncated: idx.length > MAX_BOUND,
			composed,
			fields: Object.entries(meta.fields)
				.slice(0, 80)
				.map(([path, d]) => ({ path, meaning: d.meaning, unit: d.unit })),
			valueDocs: Object.entries(meta.valueDocs)
				.flatMap(([path, routes]) => routes.map(r => ({ path, match: r.match, doc: r.doc })))
				.slice(0, 120),
		};
	}

	/** Read a resource file inside a skill's folder (capped, traversal-safe). */
	public async readSkillResource(name: string, path: string): Promise<{ text: string; truncated: boolean }> {
		const c = await this.ctx();
		const meta = this.byName(c, name);
		let text: string;
		try {
			text = await readResource(meta, path);
		} catch (e) {
			throw new NvmCapabilityError(e instanceof Error ? e.message : String(e));
		}
		return { text: text.slice(0, MAX_RESOURCE), truncated: text.length > MAX_RESOURCE };
	}

	/** Paragraph search across all skills (including unbound ones), with related blocks. */
	public async searchKnowledge(query: string, limit = 10): Promise<(KnowledgeHit & { boundBlocks?: string[] })[]> {
		const c = await this.ctx();
		const docs = await Promise.all(
			c.index.skills.filter(s => s.enabled).map(async meta => ({ meta, body: (await this.reg().load(meta)).body })),
		);
		return searchKnowledgeText(query, docs, limit).map(h => {
			const idx = c.bindings?.get(h.skill);
			return idx ? { ...h, boundBlocks: idx.slice(0, 10).map(i => c.blocks![i].name ?? c.blocks![i].id) } : h;
		});
	}

	/** Block skills bound to a block (precedence order). */
	private async skillsFor(block: NvmBlockInfo): Promise<SkillMeta[]> {
		if (!this.available) {
			return [];
		}
		const c = await this.ctx();
		if (!c.blocks || !c.bindings) {
			return [];
		}
		const i = c.blocks.indexOf(block);
		return c.index.skills.filter(s => (c.bindings!.get(s.name) ?? []).includes(i));
	}

	/** The bounded `knowledge:` appendix for a tool result (empty when none applies). */
	public async knowledgeFor(block: NvmBlockInfo | undefined, withFields = true): Promise<string> {
		if (!block) {
			return "";
		}
		try {
			return knowledgeSection(block, await this.skillsFor(block), withFields);
		} catch {
			return "";
		}
	}

	/** Appendix for a block addressed by name (as the tools receive it). */
	public async knowledgeForName(name: string, withFields = true): Promise<string> {
		try {
			return await this.knowledgeFor(this.dump.find(name), withFields);
		} catch {
			return "";
		}
	}

	/** Names-only appendix for blocks addressed by name (search results). */
	public async knowledgeForNames(names: string[]): Promise<string> {
		try {
			const blocks = names.map(n => this.dump.find(n)).filter((b): b is NvmBlockInfo => !!b);
			return await this.knowledgeForMany(blocks);
		} catch {
			return "";
		}
	}

	/** Names-only appendix for a list of blocks (search results). */
	public async knowledgeForMany(blocks: NvmBlockInfo[]): Promise<string> {
		if (!this.available || !blocks.length) {
			return "";
		}
		try {
			const c = await this.ctx();
			if (!c.blocks || !c.bindings) {
				return "";
			}
			const set = new Set(blocks.map(b => c.blocks!.indexOf(b)));
			const hits = c.index.skills
				.map(s => ({ s, n: (c.bindings!.get(s.name) ?? []).filter(i => set.has(i)).length }))
				.filter(x => x.n > 0);
			return hits.length
				? `knowledge:\n${hits.map(x => `  skill: ${x.s.name} covers ${x.n} of these blocks — ${x.s.description}`).join("\n")}`.slice(0, 1500)
				: "";
		} catch {
			return "";
		}
	}

	/**
	 * The per-request catalog for the chat system prompt (§6.1/6.2): explicit
	 * `skill:name` activations + a Top-K pre-filtered list. Block skills with no
	 * binding in the active dump are omitted from the catalog.
	 */
	public async catalogFor(
		prompt: string,
		explicit: string[],
		size: number,
	): Promise<{ catalog: SkillSummary[]; activated: SkillActivation[]; unknown: string[]; restricted: boolean }> {
		const c = await this.ctx();
		const activated: SkillActivation[] = [];
		const unknown: string[] = [];
		for (const n of explicit) {
			try {
				activated.push(await this.useSkill(n));
			} catch {
				unknown.push(n);
			}
		}
		const boundCounts = c.bindings ? new Map([...c.bindings].map(([k, v]) => [k, v.length])) : undefined;
		const catalog =
			skillsMode() === "manual"
				? []
				: selectCatalog(prompt, c.index.skills, { size, boundCounts })
						.filter(s => !explicit.includes(s.name))
						.map(s => this.summary(s, c));
		return { catalog, activated, unknown, restricted: c.index.restricted };
	}

	/** Evaluate skill rules + relations over the active dump. */
	public async checkRules(opts: { skills?: string[]; includePass?: boolean } = {}): Promise<CheckSummary> {
		const c = await this.ctx();
		if (!c.blocks || !c.bindings) {
			throw new NvmCapabilityError("No active NVM dump. Open a dump in the hex editor first.");
		}
		const wanted = opts.skills?.length ? opts.skills.map(s => this.byName(c, s).name) : undefined;
		// A playbook may compose block skills via `uses`: checking it checks them.
		const expanded = wanted
			? [...new Set(wanted.flatMap(n => [n, ...(c.index.skills.find(s => s.name === n)?.uses ?? [])]))]
			: undefined;
		return checkSkills(c.index.skills, c.bindings, c.blocks, { skills: expanded, includePass: opts.includePass });
	}

	/** Index diagnostics (for /skills and the diagnostics command). */
	public async diagnostics(): Promise<SkillDiagnostic[]> {
		return (await this.ctx()).index.diagnostics;
	}
}
