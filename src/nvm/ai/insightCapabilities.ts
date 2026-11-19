// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Insight capabilities (`caps.insights`): what deserves attention in the
 * active dump, for the Overview panel. Combines the generic risk heuristics
 * with failed skill rules/relations, and turns the loaded skills into
 * one-click questions. Never throws for "no dump" / "no skills": it simply
 * returns fewer insights.
 */

import { InsightFinding, InsightSeverity, NvmInsights, SuggestedQuestion } from "../../../shared/nvm/views/insights";
import { ActiveDump } from "./activeDump";
import { SkillCapabilities } from "./skillCapabilities";

const MAX_FINDINGS = 12;
const MAX_QUESTIONS = 4;
const MAX_LABEL = 90;

/** The generic risk heuristics live on the core facade; injected as a function. */
export type RiskSource = () => { risks: string[] };

const shorten = (text: string) => {
	const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
	return first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first;
};

export class InsightCapabilities {
	constructor(
		private readonly dump: ActiveDump,
		private readonly risks: RiskSource,
		private readonly skills: SkillCapabilities,
	) {}

	public async insights(): Promise<NvmInsights> {
		const findings: InsightFinding[] = this.riskFindings();
		findings.push(...(await this.ruleFindings()));
		const order: Record<InsightSeverity, number> = { error: 0, warning: 1, info: 2 };
		findings.sort((a, b) => order[a.severity] - order[b.severity]);
		return {
			findings: findings.slice(0, MAX_FINDINGS),
			questions: await this.questions(),
			truncated: findings.length > MAX_FINDINGS,
		};
	}

	private riskFindings(): InsightFinding[] {
		try {
			return this.risks().risks.map(message => ({ severity: "warning" as const, message, source: "risk" }));
		} catch {
			return [];
		}
	}

	private async ruleFindings(): Promise<InsightFinding[]> {
		if (!this.skills.available) {
			return [];
		}
		try {
			const check = await this.skills.checkRules();
			return check.findings
				.filter(f => f.status === "fail" || f.status === "error")
				.map(f => ({
					severity: f.status === "error" ? ("info" as const) : f.severity,
					message: `${f.block ? `${f.block}: ` : ""}${f.message}`,
					offset: f.block ? this.dump.find(f.block)?.offset : undefined,
					source: f.skill,
				}));
		} catch {
			return [];
		}
	}

	/** Bound block skills and playbooks become starter questions. */
	private async questions(): Promise<SuggestedQuestion[]> {
		if (!this.skills.available) {
			return [];
		}
		try {
			const page = await this.skills.listSkills({ limit: 50 });
			return page.items
				.filter(s => s.kind === "playbook" || (s.boundBlocks ?? 0) > 0)
				.sort((a, b) => (b.boundBlocks ?? 0) - (a.boundBlocks ?? 0))
				.slice(0, MAX_QUESTIONS)
				.map(s => ({ label: shorten(s.description || s.name), prompt: `skill:${s.name} ${s.description}`.trim() }));
		} catch {
			return [];
		}
	}
}
