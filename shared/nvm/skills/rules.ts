// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Evaluate the declarative `rules` (single-block invariants) and `relations`
 * (cross-block timing / write / logic / business constraints) of skills over
 * the current dump. Pure, total and bounded: a broken expression becomes an
 * `error` finding, never an exception. This is what lets several skills be
 * COMBINED into one deep check — each skill contributes its own constraints,
 * and they are all evaluated against the same blocks.
 */

import type { NvmBlockInfo } from "../../protocol";
import { blockScope } from "../analysis/blockScope";
import { nameMatches, writeCorrelation } from "../analysis/timeline";
import { groupVersions, identityKey, latestBlocks, latestOf } from "../analysis/versions";
import { nodeScalar, resolvePath } from "./paths";
import { evaluatePredicate, PredicateError, truthy } from "./predicate";
import { RuleSeverity, SkillBindings, SkillMeta, SkillRelation } from "./types";

export type FindingStatus = "pass" | "fail" | "error" | "skip";

export interface RuleFinding {
	skill: string;
	id: string;
	/** `rule` or the relation kind. */
	kind: string;
	status: FindingStatus;
	severity: RuleSeverity;
	block?: string;
	partner?: string;
	message: string;
	/** Evidence: values / sequences that led to the verdict. */
	detail?: string;
	meaning?: string;
}

export interface CheckOptions {
	/** Only these skills (default: all with rules/relations). */
	skills?: string[];
	/** Include passing checks in the output (default false: only problems). */
	includePass?: boolean;
	/** Hard cap on findings (default 300). */
	max?: number;
}

export interface CheckSummary {
	findings: RuleFinding[];
	counts: Record<FindingStatus, number>;
	truncated: boolean;
}

const nameOf = (b: NvmBlockInfo) => b.name ?? b.id;
const seqText = (b: NvmBlockInfo) => (b.sequence === undefined ? "seq ?" : `seq ${b.sequence}`);

/** Run every rule + relation of the selected skills. */
export function checkSkills(
	skills: readonly SkillMeta[],
	bindings: SkillBindings,
	blocks: readonly NvmBlockInfo[],
	opts: CheckOptions = {},
): CheckSummary {
	const max = opts.max ?? 300;
	const counts: Record<FindingStatus, number> = { pass: 0, fail: 0, error: 0, skip: 0 };
	const findings: RuleFinding[] = [];
	let truncated = false;
	const versions = groupVersions(blocks);
	const versionCount = (b: NvmBlockInfo) => versions.get(identityKey(b))?.length ?? 1;
	const latestAll = latestBlocks(blocks);

	const push = (f: RuleFinding) => {
		counts[f.status]++;
		if (f.status === "pass" && !opts.includePass) {
			return;
		}
		if (findings.length >= max) {
			truncated = true;
			return;
		}
		findings.push(f);
	};

	for (const skill of skills) {
		if (!skill.enabled || (opts.skills && !opts.skills.includes(skill.name))) {
			continue;
		}
		if (!skill.rules.length && !skill.relations.length) {
			continue;
		}
		const bound = (bindings.get(skill.name) ?? []).map(i => blocks[i]).filter(Boolean);
		// For playbooks (no binding) relations still work when `self` is given by `appliesTo`-less
		// rules: they are skipped with an explanation.
		if (bound.length === 0) {
			push({
				skill: skill.name,
				id: "*",
				kind: "binding",
				status: "skip",
				severity: "info",
				message: "no block in this dump is bound to the skill — its rules/relations were not evaluated",
			});
			continue;
		}
		const boundLatest = latestBlocks(bound);

		for (const rule of skill.rules) {
			const targets = rule.scope === "all" ? bound : boundLatest;
			for (const b of targets) {
				push(evalOne(skill, rule.id, "rule", rule.expr, rule.severity ?? "warning", b, undefined, versionCount, rule.message));
			}
		}
		for (const rel of skill.relations) {
			const partners = latestAll.filter(p => nameMatches(rel.with, p) && !boundLatest.includes(p));
			for (const self of boundLatest) {
				checkRelation(skill, rel, self, partners, blocks, bound, versionCount).forEach(push);
			}
		}
	}
	return { findings, counts, truncated };
}

function evalOne(
	skill: SkillMeta,
	id: string,
	kind: string,
	expr: string,
	severity: RuleSeverity,
	self: NvmBlockInfo,
	other: NvmBlockInfo | undefined,
	versionCount: (b: NvmBlockInfo) => number,
	message?: string,
	meaning?: string,
): RuleFinding {
	const base = { skill: skill.name, id, kind, severity, block: nameOf(self), partner: other && nameOf(other), meaning };
	try {
		const v = evaluatePredicate(expr, blockScope({ self, other, versionCount, vars: skill.params }));
		return truthy(v)
			? { ...base, status: "pass", message: `${expr} holds` }
			: { ...base, status: "fail", message: message ?? `${expr} is violated`, detail: `expr: ${expr}` };
	} catch (e) {
		const msg = e instanceof PredicateError ? e.message : String(e);
		return { ...base, status: "error", severity: "info", message: `cannot evaluate "${expr}": ${msg}` };
	}
}

function checkRelation(
	skill: SkillMeta,
	rel: SkillRelation,
	self: NvmBlockInfo,
	partners: NvmBlockInfo[],
	blocks: readonly NvmBlockInfo[],
	boundAll: NvmBlockInfo[],
	versionCount: (b: NvmBlockInfo) => number,
): RuleFinding[] {
	const sev = rel.severity ?? "warning";
	const base = { skill: skill.name, id: rel.id, kind: rel.kind, severity: sev, block: nameOf(self), meaning: rel.meaning };
	const missing = (): RuleFinding => ({
		...base,
		status: "skip",
		severity: "info",
		message: `no partner block matches "${rel.with}"`,
	});

	switch (rel.kind) {
		case "presence": {
			const wantAbsent = rel.expect === "absent";
			const ok = wantAbsent ? partners.length === 0 : partners.length > 0;
			return [
				{
					...base,
					status: ok ? "pass" : "fail",
					message: ok
						? `"${rel.with}" is ${wantAbsent ? "absent" : "present"} as expected`
						: (rel.message ?? `"${rel.with}" is ${wantAbsent ? "present but should be absent" : "missing"}`),
					detail: partners.length ? `found: ${partners.slice(0, 5).map(nameOf).join(", ")}` : undefined,
				},
			];
		}
		case "value": {
			if (!partners.length) {
				return [missing()];
			}
			return partners
				.slice(0, 20)
				.map(p => evalOne(skill, rel.id, rel.kind, rel.expr!, sev, self, p, versionCount, rel.message, rel.meaning));
		}
		case "order": {
			if (!partners.length) {
				return [missing()];
			}
			return partners.slice(0, 20).map(p => {
				const f: RuleFinding = { ...base, partner: nameOf(p), status: "pass", message: "" };
				if (self.sequence === undefined || p.sequence === undefined) {
					return { ...f, status: "skip", severity: "info", message: "write order unknown (no sequence hint)" };
				}
				const d = p.sequence - self.sequence; // >0: self written before partner
				const expect = rel.expect ?? "before";
				let ok = expect === "before" ? d > 0 : expect === "after" ? d < 0 : true;
				if (rel.within !== undefined || expect === "together") {
					ok = ok && Math.abs(d) <= (rel.within ?? 3);
				}
				return {
					...f,
					status: ok ? "pass" : "fail",
					message: ok
						? `written ${expect} ${nameOf(p)} as expected`
						: (rel.message ?? `expected to be written ${expect} ${nameOf(p)}${rel.within !== undefined ? ` within ${rel.within}` : ""}`),
					detail: `${nameOf(self)} ${seqText(self)} vs ${nameOf(p)} ${seqText(p)}`,
				};
			});
		}
		case "cowrite": {
			const within = rel.within ?? 3;
			const selfGlob = self.identity?.key ?? nameOf(self);
			const scoped = blocks.filter(b => boundAll.includes(b) || nameMatches(rel.with, b));
			const c = writeCorrelation(scoped, selfGlob, rel.with, within);
			if (c.aWrites === 0) {
				return [{ ...base, status: "skip", severity: "info", message: "write order unknown (no sequence hint)" }];
			}
			const ok = c.coWritten === c.aWrites;
			return [
				{
					...base,
					status: ok ? "pass" : "fail",
					message: ok
						? `every write is accompanied by "${rel.with}" within ${within}`
						: (rel.message ?? `${c.aWrites - c.coWritten}/${c.aWrites} writes have no "${rel.with}" within ${within}`),
					detail: `co-written ${c.coWritten}/${c.aWrites} (B before ${c.bBefore}, after ${c.bAfter})${c.orphans.length ? `; orphan seqs: ${c.orphans.join(", ")}` : ""}`,
				},
			];
		}
		case "reference": {
			const node = resolvePath(self.decoded, rel.field!)[0];
			const v = nodeScalar(node);
			if (v === undefined) {
				return [{ ...base, status: "error", severity: "info", message: `field "${rel.field}" not found in decoded data` }];
			}
			const target = blocks.find(b => nameMatches(rel.with, b) && refersTo(v, b));
			const latestTarget = target ? latestOf(blocks.filter(b => identityKey(b) === identityKey(target))) : undefined;
			return [
				{
					...base,
					partner: target && nameOf(target),
					status: target ? "pass" : "fail",
					message: target
						? `${rel.field}=${v} refers to ${nameOf(target)}`
						: (rel.message ?? `${rel.field}=${v} does not refer to any "${rel.with}" block`),
					detail: latestTarget && latestTarget !== target ? `newest instance: ${nameOf(latestTarget)}` : undefined,
				},
			];
		}
	}
	return [];
}

/** Does a field value identify block `b` (by id, identity key, offset or numeric id)? */
function refersTo(v: string | number | boolean, b: NvmBlockInfo): boolean {
	const s = String(v).toLowerCase();
	const cands = [b.id, b.identity?.key, b.name].filter((x): x is string => !!x).map(x => x.toLowerCase());
	if (cands.includes(s)) {
		return true;
	}
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) {
		return false;
	}
	if (b.offset === n) {
		return true;
	}
	// Numeric suffix of an id/identity (e.g. "tag:0x0031" → 49).
	return cands.some(c => {
		const m = /(0x[0-9a-f]+|\d+)$/.exec(c);
		return !!m && Number(m[1]) === n;
	});
}
