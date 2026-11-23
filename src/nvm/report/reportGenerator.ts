// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Report generation. The report follows the workbench Overview — headline
 * numbers, findings, most recent write, most rewritten blocks, blocks per
 * group — then the user's annotations, with the full block list as an
 * appendix. Pure: the caller resolves note bodies and insights.
 */

import { summarizeBlocks } from "../../../shared/nvm/views/dumpSummary";
import { InsightSeverity, NvmInsights } from "../../../shared/nvm/views/insights";
import { NvmBlockInfo } from "../../../shared/protocol";
import { AnnotationSet } from "../annotations/model";
import { annotationSections, cell, hex, ownerOf } from "./reportAnnotations";

export interface ReportInput {
	fileName: string;
	blocks: NvmBlockInfo[];
	annotations: AnnotationSet;
	/** Note id -> markdown body (resolved by the caller). */
	noteBodies: Map<string, string>;
	/** Overview findings; the section is omitted when not provided. */
	insights?: NvmInsights;
	/** Optional AI-generated summary to prepend. */
	aiSummary?: string;
	/** Timestamp to print (defaults to now; fixed in tests). */
	generatedAt?: Date;
}

const SEVERITY: Record<InsightSeverity, string> = { error: "❌", warning: "⚠️", info: "ℹ️" };
const blockName = (b: NvmBlockInfo) => b.name ?? b.id;

/** Render the full Markdown report. */
export function generateReport(input: ReportInput): string {
	const { fileName, blocks, annotations, noteBodies, insights, aiSummary } = input;
	const summary = summarizeBlocks(blocks);
	const lines: string[] = [`# NVM Analysis Report — ${fileName}`, ""];
	lines.push(`_Generated ${(input.generatedAt ?? new Date()).toISOString()}_`, "");

	if (aiSummary) {
		lines.push("## AI Summary", "", aiSummary.trim(), "");
	}

	lines.push("## Overview", "", "| Metric | Value |", "| --- | ---: |");
	const metrics: [string, number][] = [
		["Blocks", summary.totalBlocks],
		["Logical blocks", summary.identities],
		["Latest instances", summary.latestBlocks],
		["Decoded", summary.decodedBlocks],
		["Bookmarks", annotations.bookmarks.length],
		["Notes", annotations.notes.length],
		["Tag assignments", annotations.tagAssignments.length],
	];
	lines.push(...metrics.map(([k, v]) => `| ${k} | ${v} |`), "");

	if (insights) {
		lines.push("## Findings", "");
		if (insights.findings.length === 0) {
			lines.push("_No findings from the risk checks or the loaded skill rules._");
		}
		for (const f of insights.findings) {
			const where = f.offset !== undefined ? ownerOf(f.offset, blocks) : undefined;
			const at = f.offset !== undefined ? ` — ${where ? `${blockName(where)} @ ` : ""}${hex(f.offset)}` : "";
			lines.push(`- ${SEVERITY[f.severity]} ${f.message}${at} _(${f.source})_`);
		}
		if (insights.truncated) {
			lines.push("- _… more findings (ask @nvm for a full risk detection)_");
		}
		lines.push("");
	}

	if (summary.newest) {
		lines.push("## Most recent write", "", `**${cell(blockName(summary.newest))}** @ ${hex(summary.newest.offset)}`, "");
	}

	if (summary.mostRewritten.length) {
		lines.push("## Most rewritten", "", "| Block | Versions | Latest at |", "| --- | ---: | --- |");
		for (const r of summary.mostRewritten) {
			lines.push(`| ${cell(r.label)} | ${r.versions} | ${hex(r.latest.offset)} |`);
		}
		lines.push("");
	}

	if (summary.groups.length) {
		lines.push("## Blocks per group", "", "| Group | Blocks |", "| --- | ---: |");
		lines.push(...summary.groups.map(g => `| ${cell(g.label)} | ${g.count} |`), "");
	}

	lines.push(...annotationSections(annotations, blocks, noteBodies));

	if (blocks.length) {
		lines.push("## Appendix: blocks", "", "| Name | Offset | Length | Latest | Fields |", "| --- | --- | ---: | :---: | ---: |");
		for (const b of blocks) {
			lines.push(`| ${cell(blockName(b))} | ${hex(b.offset)} | ${b.length} | ${b.isLatest ? "✓" : ""} | ${b.fields?.length ?? 0} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
