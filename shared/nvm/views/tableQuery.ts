// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Pure filter / sort / column projection over a {@link TableModel}. Used by the
 * workbench table panel and validated by the AI `nvm_filterTable` tool, so a
 * query the assistant produces behaves exactly like one the user types.
 */

import { BASE_COLUMN_KEYS, TableColumn, TableModel, TableRow } from "./blocksTableModel";

export interface TableSort {
	key: string;
	/** 1 = ascending, -1 = descending. */
	dir: 1 | -1;
}

/** Serializable table view state (stored as workbench panel params). */
export interface TableQuery {
	/** Case-insensitive substring matched against every visible cell. */
	search?: string;
	sort?: TableSort;
	/** Column keys to show (in order). Undefined = all columns. */
	columns?: string[];
	/** Only show the newest instance of each logical block. */
	latestOnly?: boolean;
}

/** Resolve the columns to display: the requested keys that exist, else all. */
export function projectColumns(
	all: readonly TableColumn[],
	keys: readonly string[] | undefined,
): TableColumn[] {
	if (!keys || keys.length === 0) {
		return [...all];
	}
	const byKey = new Map(all.map(c => [c.key, c]));
	const picked = keys.map(k => byKey.get(k)).filter((c): c is TableColumn => !!c);
	// The name column always leads so a row stays identifiable.
	const name = byKey.get(BASE_COLUMN_KEYS.name);
	if (name && !picked.includes(name)) {
		picked.unshift(name);
	}
	return picked.length > 0 ? picked : [...all];
}

function rowMatches(row: TableRow, columns: readonly TableColumn[], needle: string): boolean {
	for (const c of columns) {
		if (String(row.cells[c.key] ?? "").toLowerCase().includes(needle)) {
			return true;
		}
	}
	return false;
}

function compareRows(a: TableRow, b: TableRow, sort: TableSort, numeric: boolean): number {
	const av = a.cells[sort.key];
	const bv = b.cells[sort.key];
	let cmp: number;
	if (numeric) {
		cmp = toNumber(av) - toNumber(bv);
	} else {
		cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
	}
	return cmp * sort.dir;
}

/** Numeric cells may be hex strings (the offset column); parse both forms. */
function toNumber(v: string | number | undefined): number {
	if (typeof v === "number") {
		return v;
	}
	if (v === undefined) {
		return 0;
	}
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/** Apply a query to the model, returning the visible columns and rows. */
export function applyTableQuery(
	model: TableModel,
	query: TableQuery,
): { columns: TableColumn[]; rows: TableRow[] } {
	const columns = projectColumns(model.columns, query.columns);
	let rows = model.rows;
	if (query.latestOnly) {
		rows = rows.filter(r => !r.superseded);
	}
	const needle = query.search?.trim().toLowerCase();
	if (needle) {
		rows = rows.filter(r => rowMatches(r, columns, needle));
	}
	const sort = query.sort;
	if (sort && model.columns.some(c => c.key === sort.key)) {
		const numeric = model.columns.find(c => c.key === sort.key)?.numeric ?? false;
		rows = [...rows].sort((a, b) => compareRows(a, b, sort, numeric));
	}
	return { columns, rows };
}

/** Next sort state when a column header is clicked (asc → desc → none). */
export function cycleSort(current: TableSort | undefined, key: string): TableSort | undefined {
	if (!current || current.key !== key) {
		return { key, dir: 1 };
	}
	return current.dir === 1 ? { key, dir: -1 } : undefined;
}

/**
 * Show / hide one column. `selected` undefined means "all columns"; the
 * result is undefined again when everything ends up visible. The name column
 * cannot be hidden.
 */
export function toggleColumn(
	all: readonly TableColumn[],
	selected: readonly string[] | undefined,
	key: string,
): string[] | undefined {
	if (key === BASE_COLUMN_KEYS.name) {
		return selected ? [...selected] : undefined;
	}
	const visible = new Set(selected ?? all.map(c => c.key));
	if (visible.has(key)) {
		visible.delete(key);
	} else {
		visible.add(key);
	}
	const keys = all.map(c => c.key).filter(k => visible.has(k));
	return keys.length === all.length ? undefined : keys;
}

/** Normalize an untrusted query (e.g. from an AI tool) into a safe one. */
export function sanitizeTableQuery(input: unknown): TableQuery {
	const q = (input ?? {}) as Record<string, unknown>;
	const out: TableQuery = {};
	if (typeof q.search === "string") {
		out.search = q.search.slice(0, 200);
	}
	const sort = q.sort as Record<string, unknown> | undefined;
	if (sort && typeof sort.key === "string") {
		out.sort = { key: sort.key, dir: sort.dir === -1 || sort.dir === "desc" ? -1 : 1 };
	}
	if (Array.isArray(q.columns)) {
		out.columns = q.columns.filter((c): c is string => typeof c === "string").slice(0, 64);
	}
	if (typeof q.latestOnly === "boolean") {
		out.latestOnly = q.latestOnly;
	}
	return out;
}
