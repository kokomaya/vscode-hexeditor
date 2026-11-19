// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Blocks Tree panel: the same arrangements as the sidebar tree (by address,
 * by sector, by write order, by identity), rendered as a virtualized tree in
 * the workbench and linked to the shared selection.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { ARRANGEMENTS, arrangementById } from "../../../../../shared/nvm/views/blockArrangement";
import { blockLabel, hexOffset } from "../../../../../shared/nvm/views/blockTreeModel";
import { BlocksTreeParams } from "../../../../../shared/nvm/workbench/viewIds";
import { VirtualList, VirtualListHandle } from "../../../components/virtualList";
import * as select from "../../../state";
import { clsx, throwOnUndefinedAccessInDev } from "../../../util";
import { WorkbenchPanelProps } from "../../registry";
import { NoLayoutState } from "../noLayoutState";
import _style from "./blocksTree.css";
import { flattenTree, groupPathTo, TreeRow } from "./flattenTree";

const style = throwOnUndefinedAccessInDev(_style);

const ROW_HEIGHT = 22;
const INDENT_PX = 14;

export const BlocksTreePanel: React.FC<WorkbenchPanelProps<BlocksTreeParams>> = ({ params, setParams }) => {
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const selected = useRecoilValue(select.selectedNvmBlockAtom);
	const listRef = useRef<VirtualListHandle>(null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

	const arrangement = arrangementById(params.arrangement);
	const nodes = useMemo(() => arrangement.arrange(blocks), [arrangement, blocks]);
	const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);

	// Hex/table → tree: expand the path to the selected block and scroll to it.
	useEffect(() => {
		if (!selected) {
			return;
		}
		const path = groupPathTo(nodes, selected.id);
		if (path && path.some(k => !expanded.has(k))) {
			setExpanded(prev => new Set([...prev, ...path]));
		}
	}, [selected?.id, nodes]);

	const selectedIndex = selected ? rows.findIndex(r => r.kind === "block" && r.block.id === selected.id) : -1;
	useEffect(() => {
		if (selectedIndex >= 0) {
			listRef.current?.scrollToIndex(selectedIndex);
		}
	}, [selectedIndex]);

	if (blocks.length === 0) {
		return <NoLayoutState />;
	}

	const toggle = (key: string) =>
		setExpanded(prev => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});

	const renderRow = (index: number) => (
		<TreeRowView
			key={rowKey(rows[index])}
			row={rows[index]}
			isSelected={index === selectedIndex}
			onToggle={toggle}
		/>
	);

	return (
		<div className={style.panel}>
			<div className={style.toolbar}>
				<select
					className={style.select}
					value={arrangement.id}
					onChange={e => setParams({ arrangement: e.target.value })}
					aria-label="Arrangement"
				>
					{ARRANGEMENTS.map(a => (
						<option key={a.id} value={a.id}>
							{a.label}
						</option>
					))}
				</select>
				<button className={style.toolButton} onClick={() => setExpanded(new Set())}>
					Collapse all
				</button>
			</div>
			<div className={style.body}>
				<VirtualList ref={listRef} rowCount={rows.length} rowHeight={ROW_HEIGHT} renderRow={renderRow} />
			</div>
		</div>
	);
};

const rowKey = (row: TreeRow) => (row.kind === "group" ? `g:${row.key}` : `b:${row.block.id}`);

const TreeRowView: React.FC<{ row: TreeRow; isSelected: boolean; onToggle(key: string): void }> = ({
	row,
	isSelected,
	onToggle,
}) => {
	const indent = { paddingLeft: 6 + row.depth * INDENT_PX, height: ROW_HEIGHT };
	if (row.kind === "group") {
		return (
			<div className={style.row} style={indent} onClick={() => onToggle(row.key)}>
				<span className={style.twistie}>{row.expanded ? "▾" : "▸"}</span>
				<span className={style.label}>{row.label}</span>
				{row.description && <span className={style.description}>{row.description}</span>}
			</div>
		);
	}
	const { block } = row;
	return (
		<div
			className={clsx(style.row, isSelected && style.selected)}
			style={indent}
			onClick={() => select.revealNvm(block.offset)}
			data-vscode-context={JSON.stringify({
				webviewSection: "nvm.blocksTree",
				nvmBlockId: block.id,
				nvmOffset: block.offset,
			})}
		>
			<span className={style.twistie} />
			<span className={clsx(style.label, block.isLatest && style.latest)}>{blockLabel(block)}</span>
			<span className={style.description}>{hexOffset(block.offset)}</span>
		</div>
	);
};
