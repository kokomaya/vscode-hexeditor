// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Checkbox list for choosing which table columns are visible. */

import React from "react";
import { BASE_COLUMN_KEYS, TableColumn } from "../../../../../shared/nvm/views/blocksTableModel";
import { throwOnUndefinedAccessInDev } from "../../../util";
import _style from "./blocksTable.css";

const style = throwOnUndefinedAccessInDev(_style);

export const ColumnPicker: React.FC<{
	all: readonly TableColumn[];
	/** Currently selected keys; undefined = all columns. */
	selected: readonly string[] | undefined;
	onChange(keys: string[] | undefined): void;
	onClose(): void;
}> = ({ all, selected, onChange, onClose }) => {
	const current = new Set(selected ?? all.map(c => c.key));
	const toggle = (key: string) => {
		const next = new Set(current);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		const keys = all.map(c => c.key).filter(k => next.has(k));
		onChange(keys.length === all.length ? undefined : keys);
	};

	return (
		<div className={style.columnPicker} onKeyDown={e => e.key === "Escape" && onClose()}>
			<div className={style.columnPickerHeader}>
				<span>Columns</span>
				<button className={style.linkButton} onClick={() => onChange(undefined)}>
					Show all
				</button>
				<button className={style.linkButton} onClick={onClose}>
					Done
				</button>
			</div>
			<div className={style.columnPickerList}>
				{all.map(c => (
					<label key={c.key} className={style.columnPickerItem}>
						<input
							type="checkbox"
							checked={current.has(c.key)}
							disabled={c.key === BASE_COLUMN_KEYS.name}
							onChange={() => toggle(c.key)}
						/>
						{c.label}
					</label>
				))}
			</div>
		</div>
	);
};
