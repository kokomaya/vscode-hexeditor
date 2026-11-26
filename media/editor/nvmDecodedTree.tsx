// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The inspector's decoded value tree (produced by the engine from a struct
 * definition). Vendor-blind: it only lays out the tree the engine emitted.
 *
 * - Expanded by default; branches with many children (see
 *   {@link DECODED_COLLAPSE_THRESHOLD}) start collapsed. "Expand all" /
 *   "Collapse all" work like a search-results tree.
 * - Clicking a row reveals and selects its bytes in the hex view.
 * - Focusing a byte in the hex view opens the owning branch, scrolls to the
 *   node and highlights it.
 * - Collapsed children are not rendered at all (cheap for long arrays).
 */

import ChevronDownIcon from "@vscode/codicons/src/icons/chevron-down.svg";
import ChevronRightIcon from "@vscode/codicons/src/icons/chevron-right.svg";
import CollapseAllIcon from "@vscode/codicons/src/icons/collapse-all.svg";
import ExpandAllIcon from "@vscode/codicons/src/icons/expand-all.svg";
import React, { useEffect, useRef, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { NvmDecodedNode } from "../../shared/nvm/structRich";
import {
	childPath,
	DecodedExpandMode,
	defaultOpen,
	locateDecoded,
} from "../../shared/nvm/views/decodedTree";
import { Range } from "../../shared/util/range";
import { FocusedElement, useDisplayContext } from "./dataDisplayContext";
import _style from "./dataInspector.css";
import * as select from "./state";
import { clsx, throwOnUndefinedAccessInDev } from "./util";

const style = throwOnUndefinedAccessInDev(_style);

interface TreeCtx {
	isOpen(path: string, node: NvmDecodedNode): boolean;
	toggle(path: string, node: NvmDecodedNode): void;
	located?: string;
	reveal(path: string, node: NvmDecodedNode): void;
	format(node: NvmDecodedNode): string;
}

export const NvmDecodedTree: React.FC<{
	nodes: NvmDecodedNode[];
	/** Byte focused in the hex view; the tree follows it. */
	focusOffset?: number;
	format(node: NvmDecodedNode): string;
}> = ({ nodes, focusOffset, format }) => {
	const ctx = useDisplayContext();
	const setOffset = useSetRecoilState(select.offset);
	const columnWidth = useRecoilValue(select.columnWidth);
	const [mode, setMode] = useState<DecodedExpandMode>("auto");
	const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
	const [located, setLocated] = useState<string>();
	const containerRef = useRef<HTMLDivElement>(null);
	/** A row the user clicked: keep it highlighted when its own reveal echoes back as a focus change. */
	const clicked = useRef<{ path: string; offset: number }>();

	const isOpen = (path: string, node: NvmDecodedNode) => overrides.get(path) ?? defaultOpen(node, mode);

	// Hex → tree: open the owning branches and highlight the node.
	useEffect(() => {
		if (focusOffset === undefined) {
			return;
		}
		if (clicked.current?.offset === focusOffset) {
			setLocated(clicked.current.path);
			clicked.current = undefined;
			return;
		}
		clicked.current = undefined;
		const hit = locateDecoded(nodes, focusOffset);
		setLocated(hit?.path);
		if (hit && hit.open.length) {
			setOverrides(prev => {
				const next = new Map(prev);
				hit.open.forEach(p => next.set(p, true));
				return next;
			});
		}
	}, [focusOffset, nodes]);

	// Scroll the highlighted node into view once it is rendered.
	useEffect(() => {
		if (located) {
			containerRef.current
				?.querySelector(`[data-path="${located}"]`)
				?.scrollIntoView({ block: "nearest" });
		}
	}, [located, overrides]);

	const tree: TreeCtx = {
		isOpen,
		toggle: (path, node) => setOverrides(prev => new Map(prev).set(path, !isOpen(path, node))),
		located,
		reveal: (path, node) => {
			clicked.current = { path, offset: node.offset };
			setLocated(path);
			setOffset(select.startOfRowContainingByte(node.offset, columnWidth));
			ctx.focusedElement = new FocusedElement(false, node.offset);
			if (node.length > 0) {
				ctx.setSelectionRanges([Range.inclusive(node.offset, node.offset + node.length - 1)]);
			}
		},
		format,
	};

	const setAll = (next: DecodedExpandMode) => {
		setMode(next);
		setOverrides(new Map());
	};

	return (
		<div className={style.nvmDecodedSection}>
			<div className={style.nvmDecodedTitleRow}>
				<span className={style.nvmDecodedTitle}>Decoded</span>
				<button className={style.nvmTreeButton} title="Expand all" onClick={() => setAll("all")}>
					<ExpandAllIcon />
				</button>
				<button className={style.nvmTreeButton} title="Collapse all" onClick={() => setAll("none")}>
					<CollapseAllIcon />
				</button>
			</div>
			<div className={style.nvmDecoded} ref={containerRef}>
				{nodes.map((node, i) => (
					<DecodedRow key={i} node={node} path={childPath("", i)} depth={0} tree={tree} />
				))}
			</div>
		</div>
	);
};

const DecodedRow: React.FC<{ node: NvmDecodedNode; path: string; depth: number; tree: TreeCtx }> = ({
	node,
	path,
	depth,
	tree,
}) => {
	const hasChildren = !!node.children && node.children.length > 0;
	const open = hasChildren && tree.isOpen(path, node);
	const doc = node.doc;
	const title = doc?.meaning ? `${doc.meaning}${doc.source ? ` — skill: ${doc.source}` : ""}` : "Reveal bytes";
	// A branch may carry BOTH a summary value (e.g. a flags byte `0x1B`) and children; prefer the summary.
	const value = tree.format(node);
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;

	return (
		<>
			<div
				className={clsx(style.nvmDecodedRow, tree.located === path && style.nvmDecodedLocated)}
				style={{ paddingLeft: `${depth * 12}px` }}
				data-path={path}
				title={title}
				onClick={() => tree.reveal(path, node)}
				onDoubleClick={hasChildren ? () => tree.toggle(path, node) : undefined}
			>
				{hasChildren ? (
					<span
						className={style.nvmTwistie}
						onClick={e => {
							e.stopPropagation();
							tree.toggle(path, node);
						}}
					>
						<Chevron />
					</span>
				) : (
					<span className={style.nvmTwistie} />
				)}
				<span className={style.nvmDecodedName}>{node.name}</span>
				{hasChildren ? (
					<span className={style.nvmDecodedMeta}>
						{value || node.type}
						{!value ? ` · ${node.children!.length}` : ""}
					</span>
				) : (
					<span className={style.nvmDecodedValue}>
						{value}
						{!node.unit && doc?.unit ? ` ${doc.unit}` : ""}
					</span>
				)}
			</div>
			{!hasChildren && doc?.meaning && (
				<div className={style.nvmDecodedDoc} style={{ paddingLeft: `${depth * 12 + 28}px` }}>
					{doc.meaning}
				</div>
			)}
			{open &&
				node.children!.map((child, i) => (
					<DecodedRow key={i} node={child} path={childPath(path, i)} depth={depth + 1} tree={tree} />
				))}
		</>
	);
};
