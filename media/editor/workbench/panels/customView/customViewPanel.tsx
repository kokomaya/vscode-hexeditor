// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Custom View panel: a user-composed comparison view (e.g. "Reset", "DEM")
 * resolved locally from its definition against the dump's blocks. Several
 * instances can show different views side by side. Mutations (rename, delete,
 * promote, remove group) go to the host, which persists and re-pushes.
 */

import React, { useMemo } from "react";
import { useRecoilValue } from "recoil";
import { customViewGroups } from "../../../../../shared/nvm/customView";
import { TableQuery } from "../../../../../shared/nvm/views/tableQuery";
import { CustomViewParams } from "../../../../../shared/nvm/workbench/viewIds";
import { EmptyState } from "../../../components/emptyState";
import * as select from "../../../state";
import { throwOnUndefinedAccessInDev } from "../../../util";
import { WorkbenchPanelProps } from "../../registry";
import _style from "./customView.css";
import { CustomViewGroup } from "./customViewGroup";

const style = throwOnUndefinedAccessInDev(_style);

/** Stable default so a group's table memoization isn't invalidated every render. */
const DEFAULT_QUERY: TableQuery = {};

export const CustomViewPanel: React.FC<WorkbenchPanelProps<CustomViewParams>> = ({ params, setParams }) => {
	const refs = useRecoilValue(select.nvmCustomViewsListAtom);
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const current = refs.find(r => r.id === params.customViewId) ?? refs[0];
	const groups = useMemo(
		() => (current?.definition ? customViewGroups(current.definition, blocks) : undefined),
		[current?.definition, blocks],
	);
	const setGroupQuery = (groupKey: string, patch: Partial<TableQuery>) => {
		const tables = params.groupTables ?? {};
		setParams({ groupTables: { ...tables, [groupKey]: { ...(tables[groupKey] ?? {}), ...patch } } });
	};

	if (refs.length === 0) {
		return (
			<EmptyState
				title="No custom views yet"
				message='Click "+" on a row of the Blocks table (or "Add to Custom View" in the Inspector) to collect blocks into a comparison view, e.g. "Reset" or "DEM".'
			/>
		);
	}

	const command = select.sendCustomViewCommand;
	return (
		<div className={style.panel}>
			<div className={style.toolbar}>
				<select
					className={style.select}
					value={current?.id}
					onChange={e => setParams({ customViewId: e.target.value })}
					aria-label="Custom view"
				>
					{refs.map(r => (
						<option key={r.id} value={r.id}>
							{r.definition?.scope === "template" ? `${r.name} (template)` : r.name}
						</option>
					))}
				</select>
				{current && (
					<>
						<button className={style.toolButton} onClick={() => command({ kind: "renameView", viewId: current.id })}>
							Rename
						</button>
						<button
							className={style.toolButton}
							title="Make this view a reusable template for other dumps"
							onClick={() => command({ kind: "promoteToTemplate", viewId: current.id })}
						>
							Promote
						</button>
						<button className={style.toolButton} onClick={() => command({ kind: "deleteView", viewId: current.id })}>
							Delete
						</button>
					</>
				)}
			</div>
			<div className={style.body}>
				{!current || !groups || groups.length === 0 ? (
					<div className={style.muted}>This view has no blocks yet.</div>
				) : (
					groups.map(g => (
						<CustomViewGroup
							key={g.key}
							group={g}
							query={params.groupTables?.[g.key] ?? DEFAULT_QUERY}
							onQuery={patch => setGroupQuery(g.key, patch)}
							onRemove={() => command({ kind: "deleteGroup", viewId: current.id, groupKey: g.key })}
						/>
					))
				)}
			</div>
		</div>
	);
};
