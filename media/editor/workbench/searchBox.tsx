// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Workbench-wide search: type a block name, a field name or value, an
 * address, or annotation text; results are grouped by kind and revealed on
 * click / Enter (hex, table, tree and inspector follow via the shared
 * selection).
 */

import SearchIcon from "@vscode/codicons/src/icons/search.svg";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { SearchHit, SearchHitKind, unifiedSearch } from "../../../shared/nvm/views/unifiedSearch";
import * as select from "../state";
import { clsx, throwOnUndefinedAccessInDev } from "../util";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

const DEBOUNCE_MS = 120;

const KIND_LABELS: Record<SearchHitKind, string> = {
	address: "Address",
	block: "Blocks",
	field: "Fields & values",
	annotation: "Annotations",
};

export const SearchBox: React.FC = () => {
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const annotations = useRecoilValue(select.nvmAnnotationsAtom);
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const t = setTimeout(() => setQuery(text), DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [text]);

	const hits = useMemo(() => unifiedSearch(query, blocks, annotations), [query, blocks, annotations]);
	useEffect(() => setActive(0), [hits]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		window.addEventListener("mousedown", onDown, true);
		return () => window.removeEventListener("mousedown", onDown, true);
	}, []);

	const pick = (hit: SearchHit | undefined) => {
		if (hit) {
			select.revealNvm(hit.offset);
			setOpen(false);
		}
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			setOpen(true);
			setActive(i => Math.max(0, Math.min(hits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
			e.preventDefault();
		} else if (e.key === "Enter") {
			pick(hits[active]);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div ref={rootRef} className={style.searchBox}>
			<SearchIcon className={style.searchIcon} />
			<input
				className={style.searchInput}
				placeholder="Search blocks, fields, values, 0x addresses, notes…"
				aria-label="Search the dump"
				value={text}
				onChange={e => {
					setText(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={onKeyDown}
			/>
			{open && query.trim() && (
				<div className={style.searchResults} role="listbox">
					{hits.length === 0 && <div className={style.searchEmpty}>No matches</div>}
					{hits.map((hit, i) => (
						<React.Fragment key={`${hit.kind}:${hit.label}:${hit.offset}:${i}`}>
							{(i === 0 || hits[i - 1].kind !== hit.kind) && (
								<div className={style.searchGroup}>{KIND_LABELS[hit.kind]}</div>
							)}
							<div
								role="option"
								aria-selected={i === active}
								className={clsx(style.searchHit, i === active && style.searchHitActive)}
								onMouseEnter={() => setActive(i)}
								onMouseDown={e => {
									e.preventDefault();
									pick(hit);
								}}
							>
								<span className={style.searchHitLabel}>{hit.label}</span>
								{hit.detail && <span className={style.searchHitDetail}>{hit.detail}</span>}
							</div>
						</React.Fragment>
					))}
				</div>
			)}
		</div>
	);
};
