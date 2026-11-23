// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Blocks Table panel: the primary structured view. Computes the vendor-neutral
 * table model directly from the blocks the editor webview already holds (no
 * host round-trip), and is two-way linked with the hex grid through the shared
 * Recoil selection: clicking a row reveals the block; selecting bytes in the
 * hex grid scrolls the owning row into view.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { buildTableModel, TableRow } from "../../../../../shared/nvm/views/blocksTableModel";
import { applyTableQuery, cycleSort } from "../../../../../shared/nvm/views/tableQuery";
import { BlocksTableParams } from "../../../../../shared/nvm/workbench/viewIds";
import { VirtualList, VirtualListHandle } from "../../../components/virtualList";
import * as select from "../../../state";
import { clsx, throwOnUndefinedAccessInDev } from "../../../util";
import { WorkbenchPanelProps } from "../../registry";
import { NoLayoutState } from "../noLayoutState";
import _style from "./blocksTable.css";
import { ColumnMenu } from "./columnMenu";
import { ColumnPicker } from "./columnPicker";
import { estimateColumnWidths, gridTemplate } from "./columnWidths";
import { TableToolbar } from "./tableToolbar";

const style = throwOnUndefinedAccessInDev(_style);

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 24;
const ACTION_COLUMN_PX = 24;

export const BlocksTablePanel: React.FC<WorkbenchPanelProps<BlocksTableParams>> = ({
	params,
	setParams,
}) => {
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const selected = useRecoilValue(select.selectedNvmBlockAtom);
	const listRef = useRef<VirtualListHandle>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [pickingColumns, setPickingColumns] = useState(false);
	const [columnMenu, setColumnMenu] = useState<{ x: number; y: number }>();

	const model = useMemo(() => buildTableModel(blocks), [blocks]);
	const view = useMemo(() => applyTableQuery(model, params), [model, params]);
	const widths = useMemo(() => estimateColumnWidths(view.columns, model.rows), [view.columns, model.rows]);
	const template = gridTemplate(widths, ACTION_COLUMN_PX);
	const totalWidth = widths.reduce((a, b) => a + b, ACTION_COLUMN_PX);

	const selectedIndex = selected ? view.rows.findIndex(r => r.blockId === selected.id) : -1;
	const selectedHidden = !!selected && selectedIndex < 0 && model.rows.some(r => r.blockId === selected.id);

	// Hex → table: keep the selected block's row in view.
	useEffect(() => {
		if (selectedIndex >= 0) {
			listRef.current?.scrollToIndex(selectedIndex);
		}
	}, [selected?.id, selectedIndex]);

	const closeColumnMenu = useCallback(() => setColumnMenu(undefined), []);

	if (blocks.length === 0) {
		return <NoLayoutState />;
	}

	const onKeyDown = (e: React.KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
			searchRef.current?.focus();
			searchRef.current?.select();
			e.preventDefault();
		} else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === e.currentTarget) {
			const next = Math.min(view.rows.length - 1, Math.max(0, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
			if (view.rows[next]) {
				select.revealNvm(view.rows[next].offset);
			}
			e.preventDefault();
		}
	};

	const header = (
		<div
			className={style.headerRow}
			style={{ gridTemplateColumns: template, height: HEADER_HEIGHT }}
			title="Click to sort · right-click to show / hide columns"
			onContextMenu={e => {
				e.preventDefault();
				e.stopPropagation();
				setColumnMenu({ x: e.clientX, y: e.clientY });
			}}
		>
			<div />
			{view.columns.map(c => {
				const sorted = params.sort?.key === c.key ? params.sort.dir : 0;
				return (
					<div
						key={c.key}
						className={clsx(style.headerCell, c.numeric && style.numeric)}
						onClick={() => setParams({ sort: cycleSort(params.sort, c.key) })}
					>
						{c.label}
						{sorted === 1 ? " ▴" : sorted === -1 ? " ▾" : ""}
					</div>
				);
			})}
		</div>
	);

	const renderRow = (index: number) => {
		const row = view.rows[index];
		return (
			<TableRowView
				key={row.blockId}
				row={row}
				columns={view.columns}
				template={template}
				isSelected={index === selectedIndex}
			/>
		);
	};

	return (
		<div className={style.panel} tabIndex={0} onKeyDown={onKeyDown}>
			<TableToolbar
				search={params.search ?? ""}
				onSearch={search => setParams({ search: search || undefined })}
				latestOnly={!!params.latestOnly}
				onLatestOnly={latestOnly => setParams({ latestOnly: latestOnly || undefined })}
				onColumns={() => setPickingColumns(v => !v)}
				shown={view.rows.length}
				total={model.rows.length}
				searchRef={searchRef}
			/>
			{pickingColumns && (
				<ColumnPicker
					all={model.columns}
					selected={params.columns}
					onChange={columns => setParams({ columns })}
					onClose={() => setPickingColumns(false)}
				/>
			)}
			{columnMenu && (
				<ColumnMenu
					x={columnMenu.x}
					y={columnMenu.y}
					all={model.columns}
					selected={params.columns}
					onChange={columns => setParams({ columns })}
					onClose={closeColumnMenu}
				/>
			)}
			{selectedHidden && (
				<div className={style.hiddenBanner}>
					The selected block is hidden by the current filter.
					<button
						className={style.linkButton}
						onClick={() => setParams({ search: undefined, latestOnly: undefined })}
					>
						Show it
					</button>
				</div>
			)}
			<div className={style.body}>
				<VirtualList
					ref={listRef}
					rowCount={view.rows.length}
					rowHeight={ROW_HEIGHT}
					header={header}
					headerHeight={HEADER_HEIGHT}
					minWidth={totalWidth}
					renderRow={renderRow}
				/>
			</div>
		</div>
	);
};

const TableRowView: React.FC<{
	row: TableRow;
	columns: ReturnType<typeof applyTableQuery>["columns"];
	template: string;
	isSelected: boolean;
}> = ({ row, columns, template, isSelected }) => (
	<div
		className={clsx(style.row, isSelected && style.selected, row.isLatest && style.latest)}
		style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
		onClick={() => select.revealNvm(row.offset)}
		data-vscode-context={JSON.stringify({
			webviewSection: "nvm.blocksTable",
			nvmBlockId: row.blockId,
			nvmOffset: row.offset,
		})}
	>
		<div className={style.actionCell}>
			<button
				className={style.addButton}
				title="Add this block (and matching blocks) to a custom view"
				onClick={e => {
					e.stopPropagation();
					select.sendCustomViewCommand({ kind: "addBlock", viewId: "__new__", blockId: row.blockId, by: "fingerprint" });
				}}
			>
				+
			</button>
		</div>
		{columns.map(c => (
			<div key={c.key} className={clsx(style.cell, c.numeric && style.numeric)} title={String(row.cells[c.key] ?? "")}>
				{row.cells[c.key] ?? ""}
			</div>
		))}
	</div>
);
