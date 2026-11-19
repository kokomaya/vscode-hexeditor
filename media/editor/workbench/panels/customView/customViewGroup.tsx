// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** One comparison sub-table of a custom view (a group of matching blocks). */

import React from "react";
import { ResolvedGroup } from "../../../../../shared/nvm/customView";
import * as select from "../../../state";
import { throwOnUndefinedAccessInDev } from "../../../util";
import _style from "./customView.css";

const style = throwOnUndefinedAccessInDev(_style);

/** Cap on rows rendered per group (mirrors the sidebar view). */
const MAX_ROWS = 500;

export const CustomViewGroup: React.FC<{ group: ResolvedGroup; onRemove(): void }> = ({ group, onRemove }) => {
	const rows = group.rows.length > MAX_ROWS ? group.rows.slice(0, MAX_ROWS) : group.rows;
	return (
		<section className={style.group}>
			<div className={style.groupHeader}>
				<span className={style.groupTitle}>
					{group.label} · {group.matchedBlocks} block{group.matchedBlocks === 1 ? "" : "s"}
				</span>
				<button className={style.iconButton} title="Remove this group from the view" onClick={onRemove}>
					✕
				</button>
			</div>
			{rows.length === 0 ? (
				<div className={style.muted}>No matching blocks in this dump.</div>
			) : (
				<div className={style.tableWrap}>
					<table className={style.table}>
						<thead>
							<tr>
								<th>Block</th>
								{group.columns.map(c => (
									<th key={c.key}>{c.label}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map(row => (
								<tr key={`${row.blockOffset}:${row.blockLabel}`}>
									<td className={style.blockCell} onClick={() => select.revealNvm(row.blockOffset)}>
										{row.blockLabel}
									</td>
									{group.columns.map(c => {
										const cell = row.cells[c.key];
										const target = cell?.offset;
										return (
											<td
												key={c.key}
												className={target !== undefined ? style.clickable : undefined}
												onClick={target !== undefined ? () => select.revealNvm(target) : undefined}
											>
												{cell?.text ?? ""}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{rows.length < group.rows.length && (
				<div className={style.muted}>
					showing {rows.length} of {group.rows.length} rows
				</div>
			)}
		</section>
	);
};
