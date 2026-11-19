// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Overview panel: the landing view — what is in this dump, where the activity
 * is, what the user annotated, and one-click questions for @nvm. Everything is
 * computed from generic block metadata (no vendor knowledge).
 */

import React, { useMemo } from "react";
import { useRecoilValue } from "recoil";
import { blockLabel, hexOffset } from "../../../../../shared/nvm/views/blockTreeModel";
import { summarizeBlocks } from "../../../../../shared/nvm/views/dumpSummary";
import { NvmBlockInfo } from "../../../../../shared/protocol";
import * as select from "../../../state";
import { throwOnUndefinedAccessInDev } from "../../../util";
import { runHostAction } from "../../hostLink";
import { WorkbenchPanelProps } from "../../registry";
import { NoLayoutState } from "../noLayoutState";
import _style from "./overview.css";
import { FindingsSection, QuestionsSection, useInsights } from "./overviewInsights";

const style = throwOnUndefinedAccessInDev(_style);

const MAX_GROUP_BARS = 16;

export const OverviewPanel: React.FC<WorkbenchPanelProps> = () => {
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const annotations = useRecoilValue(select.nvmAnnotationsAtom);
	const summary = useMemo(() => summarizeBlocks(blocks), [blocks]);
	const insights = useInsights(blocks);

	if (blocks.length === 0) {
		return <NoLayoutState />;
	}

	const maxGroup = Math.max(1, ...summary.groups.map(g => g.count));

	return (
		<div className={style.overview}>
			<section className={style.tiles}>
				<Tile label="Blocks" value={summary.totalBlocks} />
				<Tile label="Logical blocks" value={summary.identities} />
				<Tile label="Latest instances" value={summary.latestBlocks} />
				<Tile label="Decoded" value={summary.decodedBlocks} />
				<Tile label="Bookmarks" value={annotations.bookmarks.length} />
				<Tile label="Notes" value={annotations.notes.length} />
			</section>

			<FindingsSection insights={insights} />
			<QuestionsSection insights={insights} />

			{summary.newest && (
				<section className={style.section}>
					<h3>Most recent write</h3>
					<BlockLink block={summary.newest} />
				</section>
			)}

			{summary.mostRewritten.length > 0 && (
				<section className={style.section}>
					<h3>Most rewritten</h3>
					<ul className={style.list}>
						{summary.mostRewritten.map(r => (
							<li key={r.key}>
								<BlockLink block={r.latest} label={r.label} />
								<span className={style.muted}> · {r.versions} versions</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{summary.groups.length > 0 && (
				<section className={style.section}>
					<h3>Blocks per group</h3>
					{summary.groups.slice(0, MAX_GROUP_BARS).map(g => (
						<div key={g.key} className={style.barRow}>
							<span className={style.barLabel} title={g.label}>
								{g.label}
							</span>
							<span className={style.barTrack}>
								<span className={style.bar} style={{ width: `${(g.count / maxGroup) * 100}%` }} />
							</span>
							<span className={style.barValue}>{g.count}</span>
						</div>
					))}
				</section>
			)}

			<section className={style.section}>
				<button className={style.linkButton} onClick={() => runHostAction("openReport")}>
					Open report preview
				</button>
			</section>
		</div>
	);
};

const Tile: React.FC<{ label: string; value: number }> = ({ label, value }) => (
	<div className={style.tile}>
		<div className={style.tileValue}>{value.toLocaleString()}</div>
		<div className={style.tileLabel}>{label}</div>
	</div>
);

const BlockLink: React.FC<{ block: NvmBlockInfo; label?: string }> = ({ block, label }) => (
	<button className={style.linkButton} onClick={() => select.revealNvm(block.offset)}>
		{label ?? blockLabel(block)} @ {hexOffset(block.offset)}
	</button>
);
