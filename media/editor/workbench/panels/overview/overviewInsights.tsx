// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Overview sections fed by the host: findings (risk heuristics + failed skill
 * rules) and suggested questions (skill-based first, then generic ones).
 */

import React, { useEffect, useState } from "react";
import { EMPTY_INSIGHTS, InsightSeverity, NvmInsights } from "../../../../../shared/nvm/views/insights";
import { NvmBlockInfo } from "../../../../../shared/protocol";
import * as select from "../../../state";
import { clsx, throwOnUndefinedAccessInDev } from "../../../util";
import { askAi, fetchInsights } from "../../hostLink";
import _style from "./overview.css";

const style = throwOnUndefinedAccessInDev(_style);

const REFRESH_DEBOUNCE_MS = 400;

/** Generic starter questions; they work for any vendor / layout. */
const GENERIC_QUESTIONS = [
	"Give me an overview of this dump and point out anything suspicious.",
	"Run a risk detection on this dump and explain the findings.",
	"Which blocks were written most recently, and what changed?",
	"Which blocks are rewritten most often, and is that expected?",
];

const SEVERITY_ICON: Record<InsightSeverity, string> = { error: "⛔", warning: "⚠", info: "ℹ" };

/** Re-fetch insights whenever the blocks change (debounced). */
export const useInsights = (blocks: readonly NvmBlockInfo[]): NvmInsights | undefined => {
	const [insights, setInsights] = useState<NvmInsights>();
	useEffect(() => {
		let cancelled = false;
		const t = setTimeout(() => {
			void fetchInsights().then(i => !cancelled && setInsights(i));
		}, REFRESH_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [blocks]);
	return insights;
};

export const FindingsSection: React.FC<{ insights: NvmInsights | undefined }> = ({ insights }) => {
	if (!insights) {
		return (
			<section className={style.section}>
				<h3>Findings</h3>
				<div className={style.muted}>Checking…</div>
			</section>
		);
	}
	return (
		<section className={style.section}>
			<h3>Findings</h3>
			{insights.findings.length === 0 ? (
				<div className={style.muted}>No risks or rule violations detected.</div>
			) : (
				<ul className={style.findings}>
					{insights.findings.map((f, i) => {
						const target = f.offset;
						return (
							<li key={i} className={clsx(style.finding, style[f.severity])}>
								<span className={style.findingIcon}>{SEVERITY_ICON[f.severity]}</span>
								{target !== undefined ? (
									<button className={style.linkButton} onClick={() => select.revealNvm(target)}>
										{f.message}
									</button>
								) : (
									<span>{f.message}</span>
								)}
								<span className={style.muted}> · {f.source}</span>
							</li>
						);
					})}
					{insights.truncated && <li className={style.muted}>… more — ask @nvm to check the rules</li>}
				</ul>
			)}
		</section>
	);
};

export const QuestionsSection: React.FC<{ insights: NvmInsights | undefined }> = ({ insights }) => {
	const skillQuestions = (insights ?? EMPTY_INSIGHTS).questions;
	return (
		<section className={style.section}>
			<h3>Ask @nvm</h3>
			<div className={style.questions}>
				{skillQuestions.map(q => (
					<button key={q.prompt} className={clsx(style.question, style.skillQuestion)} onClick={() => askAi(q.prompt)} title={q.prompt}>
						{q.label}
					</button>
				))}
				{GENERIC_QUESTIONS.map(q => (
					<button key={q} className={style.question} onClick={() => askAi(q)}>
						{q}
					</button>
				))}
			</div>
		</section>
	);
};
