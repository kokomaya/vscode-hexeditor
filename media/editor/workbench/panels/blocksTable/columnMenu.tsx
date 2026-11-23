// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Right-click menu on the table header: one checkable entry per column
 * (click to hide, click again to show), plus "Show all columns". The menu
 * stays open so several columns can be toggled in a row.
 */

import React from "react";
import { BASE_COLUMN_KEYS, TableColumn } from "../../../../../shared/nvm/views/blocksTableModel";
import { toggleColumn } from "../../../../../shared/nvm/views/tableQuery";
import { ContextMenu, ContextMenuItem } from "../../../components/contextMenu";

export interface ColumnMenuProps {
	x: number;
	y: number;
	all: readonly TableColumn[];
	/** Visible keys; undefined = all columns. */
	selected: readonly string[] | undefined;
	onChange(keys: string[] | undefined): void;
	onClose(): void;
}

export const ColumnMenu: React.FC<ColumnMenuProps> = ({ x, y, all, selected, onChange, onClose }) => {
	const visible = new Set(selected ?? all.map(c => c.key));
	const items: ContextMenuItem[] = all.map(c => ({
		label: c.label,
		checked: visible.has(c.key),
		disabled: c.key === BASE_COLUMN_KEYS.name,
		keepOpen: true,
		onSelect: () => onChange(toggleColumn(all, selected, c.key)),
	}));
	items.push({
		label: "Show all columns",
		separator: true,
		disabled: selected === undefined,
		onSelect: () => onChange(undefined),
	});
	return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
};
