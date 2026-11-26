// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Pure helpers for the inspector's decoded value tree: default expansion and
 * "which node owns this byte" lookup. Shape-driven only — no field names, no
 * vendor knowledge. Nodes are addressed by their index path ("0/3/1").
 */

import { NvmDecodedNode } from "../structRich";

/** A branch with more direct children than this starts collapsed. */
export const DECODED_COLLAPSE_THRESHOLD = 32;

/** Expansion mode set by "Expand all" / "Collapse all" (`auto` = by threshold). */
export type DecodedExpandMode = "auto" | "all" | "none";

export const childPath = (parent: string, index: number): string =>
	parent ? `${parent}/${index}` : String(index);

/** Whether a branch is open when the user hasn't toggled it. */
export function defaultOpen(
	node: NvmDecodedNode,
	mode: DecodedExpandMode,
	threshold = DECODED_COLLAPSE_THRESHOLD,
): boolean {
	if (mode !== "auto") {
		return mode === "all";
	}
	return (node.children?.length ?? 0) <= threshold;
}

const contains = (n: NvmDecodedNode, offset: number): boolean =>
	n.length > 0 ? offset >= n.offset && offset < n.offset + n.length : offset === n.offset;

/** The node that best explains a byte, plus the branches to open to reveal it. */
export interface DecodedHit {
	path: string;
	/** Branch paths (outermost first) that must be open for `path` to be visible. */
	open: string[];
}

/**
 * Locate the deepest node covering `offset`. When several children of a node
 * cover the byte (e.g. bit flags of one byte), the node itself is the answer
 * and is opened so all of them show.
 */
export function locateDecoded(
	nodes: readonly NvmDecodedNode[] | undefined,
	offset: number,
	prefix = "",
): DecodedHit | undefined {
	const index = nodes?.findIndex(n => contains(n, offset)) ?? -1;
	if (!nodes || index < 0) {
		return undefined;
	}
	const node = nodes[index];
	const path = childPath(prefix, index);
	const children = node.children ?? [];
	let covering = 0;
	for (const c of children) {
		if (contains(c, offset) && ++covering > 1) {
			break;
		}
	}
	if (covering > 1) {
		return { path, open: [path] };
	}
	const deeper = covering === 1 ? locateDecoded(children, offset, path) : undefined;
	return deeper ? { path: deeper.path, open: [path, ...deeper.open] } : { path, open: [] };
}
