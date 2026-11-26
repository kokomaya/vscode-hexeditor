// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * One group of a custom view: the matching blocks in the same table as the
 * Blocks panel (same columns, sorting, column chooser, cell selection). Decoded
 * values are read in the Inspector — clicking a row selects the block there.
 */

import React from "react";
import { CustomViewGroupBlocks } from "../../../../../shared/nvm/customView";
import { TableQuery } from "../../../../../shared/nvm/views/tableQuery";
import { throwOnUndefinedAccessInDev } from "../../../util";
import { BlocksTableView } from "../blocksTable/blocksTableView";
import _style from "./customView.css";

const style = throwOnUndefinedAccessInDev(_style);

/** Rows visible per group before its table scrolls. */
const MAX_VISIBLE_ROWS = 15;

export const CustomViewGroup: React.FC<{
	group: CustomViewGroupBlocks;
	query: TableQuery;
	onQuery(patch: Partial<TableQuery>): void;
	onRemove(): void;
}> = ({ group, query, onQuery, onRemove }) => (
	<section className={style.group}>
		<div className={style.groupHeader}>
			<span className={style.groupTitle}>
				{group.label} · {group.blocks.length} block{group.blocks.length === 1 ? "" : "s"}
			</span>
			<button className={style.iconButton} title="Remove this group from the view" onClick={onRemove}>
				✕
			</button>
		</div>
		{group.blocks.length === 0 ? (
			<div className={style.muted}>No matching blocks in this dump.</div>
		) : (
			<BlocksTableView
				blocks={group.blocks}
				query={query}
				onQuery={onQuery}
				maxVisibleRows={MAX_VISIBLE_ROWS}
			/>
		)}
	</section>
);
