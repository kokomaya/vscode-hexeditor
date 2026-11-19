// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Normalization of a (validated) layout into the canonical shape every
 * renderer can rely on:
 *  - unknown / unavailable views are dropped (a bad layout never blanks the UI);
 *  - singleton views keep only their first occurrence;
 *  - empty tab groups and single-child splits collapse;
 *  - a split nested in a split of the SAME direction is flattened into its
 *    parent (dock libraries alternate orientation by depth);
 *  - sizes are normalized to integer percentages (summing to ~100).
 */

import { isSplit, LayoutNode, LayoutTab, WorkbenchLayout } from "./layoutSchema";
import { SINGLETON_VIEWS } from "./viewIds";

export interface NormalizeOptions {
	/** Whether a view id can be rendered here (registered + capability met). */
	isAvailable(view: string): boolean;
}

function toPercents(sizes: readonly number[] | undefined, count: number): number[] {
	const raw = sizes && sizes.length === count ? sizes : new Array(count).fill(1);
	const total = raw.reduce((a, b) => a + b, 0) || count;
	return raw.map(s => (s / total) * 100);
}

function normalizeNode(
	node: LayoutNode,
	opts: NormalizeOptions,
	seen: Set<string>,
): LayoutNode | undefined {
	if (!isSplit(node)) {
		const tabs: LayoutTab[] = [];
		for (const tab of node.tabs) {
			if (!opts.isAvailable(tab.view)) {
				continue;
			}
			if (SINGLETON_VIEWS.has(tab.view)) {
				if (seen.has(tab.view)) {
					continue;
				}
				seen.add(tab.view);
			}
			tabs.push(tab);
		}
		if (tabs.length === 0) {
			return undefined;
		}
		return node.active !== undefined && node.active > 0 && node.active < tabs.length
			? { tabs, active: node.active }
			: { tabs };
	}

	const percents = toPercents(node.sizes, node.children.length);
	const children: LayoutNode[] = [];
	const sizes: number[] = [];
	node.children.forEach((child, i) => {
		const n = normalizeNode(child, opts, seen);
		if (!n) {
			return;
		}
		if (isSplit(n) && n.split === node.split) {
			// Same direction: hoist grandchildren, scaling their share.
			const inner = toPercents(n.sizes, n.children.length);
			n.children.forEach((gc, j) => {
				children.push(gc);
				sizes.push((percents[i] * inner[j]) / 100);
			});
		} else {
			children.push(n);
			sizes.push(percents[i]);
		}
	});
	if (children.length === 0) {
		return undefined;
	}
	if (children.length === 1) {
		return children[0];
	}
	// Integer percentages: precise enough for a UI and stable across round-trips.
	const rounded = toPercents(sizes, sizes.length).map(p => Math.max(1, Math.round(p)));
	return { split: node.split, sizes: rounded, children };
}

/**
 * Normalize a layout. Returns `undefined` when nothing in it can be shown
 * (callers then fall back to a built-in preset).
 */
export function normalizeLayout(
	layout: WorkbenchLayout,
	opts: NormalizeOptions,
): WorkbenchLayout | undefined {
	const root = normalizeNode(layout.root, opts, new Set());
	return root ? { ...layout, root } : undefined;
}
