// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Pure, vendor-neutral column/row model for the Blocks Table. Shared by the
 * sidebar table (host computes, posts to its webview) and the workbench table
 * panel (computed directly inside the editor webview, which already holds the
 * blocks). Columns are discovered from generic {@link NvmAttribute} keys — the
 * plugin never hard-codes vendor columns.
 */

import { NvmBlockInfo } from "../../protocol";
import { blockLabel, discoverAttributeKeys, formatAttributeValue, hexOffset } from "./blockTreeModel";

export interface TableColumn {
	key: string;
	label: string;
	numeric?: boolean;
}

export interface TableRow {
	/** Editor offset of the block (row identity for jumps). */
	offset: number;
	/** Generic block id (row identity for custom-view commands / selection). */
	blockId: string;
	isLatest?: boolean;
	/** True when a newer instance of the same logical block exists. */
	superseded?: boolean;
	cells: Record<string, string | number>;
}

export interface TableModel {
	columns: TableColumn[];
	rows: TableRow[];
}

/** Keys of the fixed leading columns present for every block. */
export const BASE_COLUMN_KEYS = {
	name: "__name",
	offset: "__offset",
	length: "__length",
} as const;

/** Fixed leading columns present for every block, before engine attributes. */
export const BASE_COLUMNS: readonly TableColumn[] = [
	{ key: BASE_COLUMN_KEYS.name, label: "Name" },
	{ key: BASE_COLUMN_KEYS.offset, label: "Offset", numeric: true },
	{ key: BASE_COLUMN_KEYS.length, label: "Length", numeric: true },
];

/** Build the full table model (all discovered columns, rows ordered by offset). */
export function buildTableModel(blocks: readonly NvmBlockInfo[]): TableModel {
	const attrs = discoverAttributeKeys(blocks);
	const columns: TableColumn[] = [
		...BASE_COLUMNS,
		...attrs.map(a => ({ key: a.key, label: a.label, numeric: typeof a.value === "number" })),
	];
	const superseded = supersededIds(blocks);
	const rows = [...blocks].sort((a, b) => a.offset - b.offset).map(b => toRow(b, superseded.has(b.id)));
	return { columns, rows };
}

/**
 * Ids of blocks that have a newer instance of the same identity: when the
 * engine flags an instance `isLatest`, every other instance is superseded;
 * otherwise the highest `sequence` wins. Blocks without identity never are.
 */
export function supersededIds(blocks: readonly NvmBlockInfo[]): Set<string> {
	const byIdentity = new Map<string, NvmBlockInfo[]>();
	for (const b of blocks) {
		if (b.identity) {
			const list = byIdentity.get(b.identity.key);
			if (list) {
				list.push(b);
			} else {
				byIdentity.set(b.identity.key, [b]);
			}
		}
	}
	const out = new Set<string>();
	for (const list of byIdentity.values()) {
		if (list.length < 2) {
			continue;
		}
		const flagged = list.filter(b => b.isLatest);
		const keep =
			flagged.length > 0
				? new Set(flagged.map(b => b.id))
				: new Set([list.reduce((a, b) => ((b.sequence ?? -Infinity) > (a.sequence ?? -Infinity) ? b : a)).id]);
		for (const b of list) {
			if (!keep.has(b.id)) {
				out.add(b.id);
			}
		}
	}
	return out;
}

function toRow(block: NvmBlockInfo, superseded: boolean): TableRow {
	const cells: Record<string, string | number> = {
		[BASE_COLUMN_KEYS.name]: blockLabel(block),
		[BASE_COLUMN_KEYS.offset]: hexOffset(block.offset),
		[BASE_COLUMN_KEYS.length]: block.length,
	};
	for (const attr of block.attributes ?? []) {
		cells[attr.key] = typeof attr.value === "number" ? attr.value : formatAttributeValue(attr);
	}
	return { offset: block.offset, blockId: block.id, isLatest: block.isLatest, superseded, cells };
}
