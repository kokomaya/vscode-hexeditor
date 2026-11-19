// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Host-computed insights for the Overview panel: findings (generic risk
 * heuristics + failed skill rules/relations) and suggested questions derived
 * from the loaded skills. Plain data shared by host and webview.
 */

export type InsightSeverity = "error" | "warning" | "info";

export interface InsightFinding {
	severity: InsightSeverity;
	message: string;
	/** Where to jump, when the finding concerns one block. */
	offset?: number;
	/** Origin, e.g. "risk" or the skill name. */
	source: string;
}

export interface SuggestedQuestion {
	label: string;
	/** Text pre-filled in the chat (may force a skill with `skill:<name>`). */
	prompt: string;
}

export interface NvmInsights {
	findings: InsightFinding[];
	questions: SuggestedQuestion[];
	/** More findings exist than were returned. */
	truncated: boolean;
}

export const EMPTY_INSIGHTS: NvmInsights = { findings: [], questions: [], truncated: false };
