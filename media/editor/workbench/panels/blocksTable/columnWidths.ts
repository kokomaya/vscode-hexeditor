// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Deterministic column widths for the virtualized table. A virtual list can't
 * let the browser auto-size columns (only visible rows exist), so widths are
 * estimated once from the header + a sample of cell values.
 */

import { BASE_COLUMN_KEYS, TableColumn, TableRow } from "../../../../../shared/nvm/views/blocksTableModel";

const CHAR_PX = 7.2;
const PADDING_PX = 18;
const MIN_PX = 56;
const MAX_PX = 360;
const SAMPLE_ROWS = 400;

export function estimateColumnWidths(columns: readonly TableColumn[], rows: readonly TableRow[]): number[] {
	const sample = rows.length > SAMPLE_ROWS ? rows.slice(0, SAMPLE_ROWS) : rows;
	return columns.map(col => {
		let chars = col.label.length + 2; // room for the sort arrow
		for (const row of sample) {
			const len = String(row.cells[col.key] ?? "").length;
			if (len > chars) {
				chars = len;
			}
		}
		const min = col.key === BASE_COLUMN_KEYS.name ? 140 : MIN_PX;
		return Math.round(Math.min(MAX_PX, Math.max(min, chars * CHAR_PX + PADDING_PX)));
	});
}

/** CSS grid template: a fixed "+" action column followed by the data columns. */
export const gridTemplate = (widths: readonly number[], actionPx: number): string =>
	[`${actionPx}px`, ...widths.map(w => `${w}px`)].join(" ");
