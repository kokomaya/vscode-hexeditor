// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The block table itself: one row per block, Blocks-table columns, sort by
 * header click, show/hide columns, virtualized rows, and Excel-like cell-range
 * selection (drag / Shift+click, Ctrl+C copies the range as tab-separated
 * text). Used by the Blocks Table panel (all blocks) and by custom views (the
 * blocks of one group). A plain click on a cell still reveals the block.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { buildTableModel, TableColumn, TableRow } from "../../../../../shared/nvm/views/blocksTableModel";
import { applyTableQuery, cycleSort, TableQuery } from "../../../../../shared/nvm/views/tableQuery";
import { NvmBlockInfo } from "../../../../../shared/protocol";
import { VirtualList, VirtualListHandle } from "../../../components/virtualList";
import * as select from "../../../state";
import { clsx, throwOnUndefinedAccessInDev } from "../../../util";
import _style from "./blocksTable.css";
import { ColumnMenu } from "./columnMenu";
import { ColumnPicker } from "./columnPicker";
import { estimateColumnWidths, gridTemplate } from "./columnWidths";
import { TableToolbar } from "./tableToolbar";

const style = throwOnUndefinedAccessInDev(_style);

const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 24;
const ACTION_COLUMN_PX = 24;
const SCROLLBAR_PX = 14;

/** A cell position: row index into the visible rows, column index into the visible columns. */
interface CellPos {
	r: number;
	c: number;
}
interface CellRange {
	anchor: CellPos;
	focus: CellPos;
}

const normalize = (range: CellRange) => ({
	r0: Math.min(range.anchor.r, range.focus.r),
	r1: Math.max(range.anchor.r, range.focus.r),
	c0: Math.min(range.anchor.c, range.focus.c),
	c1: Math.max(range.anchor.c, range.focus.c),
});

/** The cell under a DOM node (cells carry `data-r` / `data-c`). */
function cellAt(target: EventTarget | null): CellPos | undefined {
	const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-c]");
	if (!el?.dataset.r || !el.dataset.c) {
		return undefined;
	}
	return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
}

/** Tab-separated text of a cell range (header row included when it spans several rows or columns). */
function rangeToTsv(range: CellRange, rows: readonly TableRow[], columns: readonly TableColumn[]): string {
	const { r0, r1, c0, c1 } = normalize(range);
	const cols = columns.slice(c0, c1 + 1);
	const lines: string[] = [];
	if (r1 > r0 || c1 > c0) {
		lines.push(cols.map(c => c.label).join("\t"));
	}
	for (let r = r0; r <= r1 && r < rows.length; r++) {
		lines.push(cols.map(c => String(rows[r].cells[c.key] ?? "")).join("\t"));
	}
	return lines.join("\n");
}

export interface BlocksTableViewProps {
	blocks: readonly NvmBlockInfo[];
	query: TableQuery;
	onQuery(patch: Partial<TableQuery>): void;
	/** Search / latest-only / column chooser toolbar (the full Blocks panel). */
	toolbar?: boolean;
	/** Leading "+" column that adds a block to a custom view. */
	addAction?: boolean;
	/**
	 * Size to the rows (up to this many visible rows, then scroll) instead of
	 * filling the parent — for several tables stacked in one panel.
	 */
	maxVisibleRows?: number;
}

export const BlocksTableView: React.FC<BlocksTableViewProps> = ({
	blocks,
	query,
	onQuery,
	toolbar,
	addAction,
	maxVisibleRows,
}) => {
	const selected = useRecoilValue(select.selectedNvmBlockAtom);
	const listRef = useRef<VirtualListHandle>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [pickingColumns, setPickingColumns] = useState(false);
	const [columnMenu, setColumnMenu] = useState<{ x: number; y: number }>();
	const [range, setRange] = useState<CellRange>();
	const drag = useRef<{ start: CellPos; moved: boolean; extend: boolean }>();

	const model = useMemo(() => buildTableModel(blocks), [blocks]);
	const view = useMemo(() => applyTableQuery(model, query), [model, query]);
	const widths = useMemo(() => estimateColumnWidths(view.columns, model.rows), [view.columns, model.rows]);
	const actionPx = addAction ? ACTION_COLUMN_PX : 0;
	const template = addAction ? gridTemplate(widths, ACTION_COLUMN_PX) : widths.map(w => `${w}px`).join(" ");
	const totalWidth = widths.reduce((a, b) => a + b, actionPx);

	const selectedIndex = selected ? view.rows.findIndex(r => r.blockId === selected.id) : -1;
	const selectedHidden = !!selected && selectedIndex < 0 && model.rows.some(r => r.blockId === selected.id);

	// Hex / inspector → table: keep the selected block's row in view.
	useEffect(() => {
		if (selectedIndex >= 0) {
			listRef.current?.scrollToIndex(selectedIndex);
		}
	}, [selected?.id, selectedIndex]);

	// Indices refer to the visible rows/columns; a new filter/sort invalidates them.
	useEffect(() => setRange(undefined), [view]);

	// End a drag wherever the mouse is released; a click without dragging reveals the block.
	useEffect(() => {
		const onUp = () => {
			const d = drag.current;
			drag.current = undefined;
			if (d && !d.moved && !d.extend) {
				const row = view.rows[d.start.r];
				if (row) {
					select.revealNvm(row.offset);
				}
			}
		};
		window.addEventListener("mouseup", onUp);
		return () => window.removeEventListener("mouseup", onUp);
	}, [view.rows]);

	const onMouseDown = (e: React.MouseEvent) => {
		const pos = e.button === 0 ? cellAt(e.target) : undefined;
		if (!pos) {
			return;
		}
		e.preventDefault(); // no native text selection (which would grab whole rows)
		rootRef.current?.focus({ preventScroll: true });
		const extend = e.shiftKey && !!range;
		setRange(extend ? { anchor: range!.anchor, focus: pos } : { anchor: pos, focus: pos });
		drag.current = { start: pos, moved: false, extend };
	};

	const onMouseOver = (e: React.MouseEvent) => {
		const d = drag.current;
		const pos = d && cellAt(e.target);
		if (!d || !pos) {
			return;
		}
		if (pos.r !== d.start.r || pos.c !== d.start.c) {
			d.moved = true;
		}
		setRange(prev => (prev && (prev.focus.r !== pos.r || prev.focus.c !== pos.c) ? { ...prev, focus: pos } : prev));
	};

	const copyRange = useCallback(
		(clipboard?: DataTransfer | null): boolean => {
			if (!range) {
				return false;
			}
			const text = rangeToTsv(range, view.rows, view.columns);
			if (clipboard) {
				clipboard.setData("text/plain", text);
			} else {
				navigator.clipboard?.writeText(text).catch(() => undefined);
			}
			return true;
		},
		[range, view],
	);

	const onKeyDown = (e: React.KeyboardEvent) => {
		const mod = e.ctrlKey || e.metaKey;
		if (toolbar && mod && (e.key === "f" || e.key === "F")) {
			searchRef.current?.focus();
			searchRef.current?.select();
			e.preventDefault();
		} else if (mod && (e.key === "a" || e.key === "A") && e.target === e.currentTarget && view.rows.length) {
			setRange({ anchor: { r: 0, c: 0 }, focus: { r: view.rows.length - 1, c: view.columns.length - 1 } });
			e.preventDefault();
		} else if (mod && (e.key === "c" || e.key === "C") && e.target === e.currentTarget) {
			if (copyRange()) {
				e.preventDefault();
			}
		} else if (e.key === "Escape" && range) {
			setRange(undefined);
		} else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === e.currentTarget) {
			const next = Math.min(view.rows.length - 1, Math.max(0, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
			if (view.rows[next]) {
				select.revealNvm(view.rows[next].offset);
			}
			e.preventDefault();
		}
	};

	const closeColumnMenu = useCallback(() => setColumnMenu(undefined), []);
	const bounds = range && normalize(range);

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
			{addAction && <div />}
			{view.columns.map(c => {
				const sorted = query.sort?.key === c.key ? query.sort.dir : 0;
				return (
					<div
						key={c.key}
						className={clsx(style.headerCell, c.numeric && style.numeric)}
						onClick={() => onQuery({ sort: cycleSort(query.sort, c.key) })}
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
		const inRows = !!bounds && index >= bounds.r0 && index <= bounds.r1;
		return (
			<TableRowView
				key={row.blockId}
				row={row}
				index={index}
				columns={view.columns}
				template={template}
				addAction={!!addAction}
				isSelected={index === selectedIndex}
				selectedCols={inRows ? bounds : undefined}
			/>
		);
	};

	const height = maxVisibleRows
		? HEADER_HEIGHT + Math.max(1, Math.min(view.rows.length, maxVisibleRows)) * ROW_HEIGHT + SCROLLBAR_PX
		: undefined;

	return (
		<div
			ref={rootRef}
			className={clsx(style.panel, maxVisibleRows !== undefined && style.embedded)}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onCopy={e => copyRange(e.clipboardData) && e.preventDefault()}
		>
			{toolbar && (
				<TableToolbar
					search={query.search ?? ""}
					onSearch={search => onQuery({ search: search || undefined })}
					latestOnly={!!query.latestOnly}
					onLatestOnly={latestOnly => onQuery({ latestOnly: latestOnly || undefined })}
					onColumns={() => setPickingColumns(v => !v)}
					shown={view.rows.length}
					total={model.rows.length}
					searchRef={searchRef}
				/>
			)}
			{pickingColumns && (
				<ColumnPicker
					all={model.columns}
					selected={query.columns}
					onChange={columns => onQuery({ columns })}
					onClose={() => setPickingColumns(false)}
				/>
			)}
			{columnMenu && (
				<ColumnMenu
					x={columnMenu.x}
					y={columnMenu.y}
					all={model.columns}
					selected={query.columns}
					onChange={columns => onQuery({ columns })}
					onClose={closeColumnMenu}
				/>
			)}
			{toolbar && selectedHidden && (
				<div className={style.hiddenBanner}>
					The selected block is hidden by the current filter.
					<button
						className={style.linkButton}
						onClick={() => onQuery({ search: undefined, latestOnly: undefined })}
					>
						Show it
					</button>
				</div>
			)}
			<div
				className={style.body}
				style={height !== undefined ? { flex: "none", height } : undefined}
				onMouseDown={onMouseDown}
				onMouseOver={onMouseOver}
			>
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
	index: number;
	columns: readonly TableColumn[];
	template: string;
	addAction: boolean;
	isSelected: boolean;
	/** Column bounds of the cell selection when it covers this row. */
	selectedCols?: { c0: number; c1: number };
}> = ({ row, index, columns, template, addAction, isSelected, selectedCols }) => (
	<div
		className={clsx(style.row, isSelected && style.selected, row.isLatest && style.latest)}
		style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
		data-vscode-context={JSON.stringify({
			webviewSection: "nvm.blocksTable",
			nvmBlockId: row.blockId,
			nvmOffset: row.offset,
		})}
	>
		{addAction && (
			<div className={style.actionCell}>
				<button
					className={style.addButton}
					title="Add this block (and matching blocks) to a custom view"
					onMouseDown={e => e.stopPropagation()}
					onClick={e => {
						e.stopPropagation();
						select.sendCustomViewCommand({ kind: "addBlock", viewId: "__new__", blockId: row.blockId, by: "fingerprint" });
					}}
				>
					+
				</button>
			</div>
		)}
		{columns.map((c, ci) => (
			<div
				key={c.key}
				data-r={index}
				data-c={ci}
				className={clsx(
					style.cell,
					c.numeric && style.numeric,
					selectedCols && ci >= selectedCols.c0 && ci <= selectedCols.c1 && style.cellSelected,
				)}
				title={String(row.cells[c.key] ?? "")}
			>
				{row.cells[c.key] ?? ""}
			</div>
		))}
	</div>
);
