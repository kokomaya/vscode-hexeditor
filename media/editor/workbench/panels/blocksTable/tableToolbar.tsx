// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Search box, "latest only" toggle, column chooser button and row count. */

import React, { useEffect, useState } from "react";
import { throwOnUndefinedAccessInDev } from "../../../util";
import _style from "./blocksTable.css";

const style = throwOnUndefinedAccessInDev(_style);

const SEARCH_DEBOUNCE_MS = 150;

export interface TableToolbarProps {
	search: string;
	onSearch(text: string): void;
	latestOnly: boolean;
	onLatestOnly(v: boolean): void;
	onColumns(): void;
	shown: number;
	total: number;
	searchRef: React.RefObject<HTMLInputElement>;
}

export const TableToolbar: React.FC<TableToolbarProps> = props => {
	const [text, setText] = useState(props.search);

	// Follow external changes (e.g. the AI applied a filter).
	useEffect(() => setText(props.search), [props.search]);

	useEffect(() => {
		if (text === props.search) {
			return;
		}
		const t = setTimeout(() => props.onSearch(text), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [text]);

	return (
		<div className={style.toolbar}>
			<input
				ref={props.searchRef}
				className={style.search}
				type="text"
				placeholder="Search blocks / attributes… (Ctrl+F)"
				aria-label="Search blocks"
				value={text}
				onChange={e => setText(e.target.value)}
				onKeyDown={e => e.key === "Escape" && setText("")}
			/>
			<label className={style.toggle} title="Only show the newest instance of each block">
				<input
					type="checkbox"
					checked={props.latestOnly}
					onChange={e => props.onLatestOnly(e.target.checked)}
				/>
				Latest only
			</label>
			<button className={style.toolButton} onClick={props.onColumns} title="Choose columns">
				Columns
			</button>
			<span className={style.count}>
				{props.shown === props.total ? `${props.total} blocks` : `${props.shown} / ${props.total}`}
			</span>
		</div>
	);
};
