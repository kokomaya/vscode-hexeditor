// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The ONLY place that knows dockview's serialized format. Converts our
 * library-independent layout tree to/from `SerializedDockview`, so replacing
 * the dock library means rewriting just this file (+ the controller).
 *
 * Dockview's grid alternates orientation by depth (root = `grid.orientation`,
 * children = orthogonal, …). Our normalized layouts already guarantee that a
 * split never directly contains a split of the same direction.
 */

import type { SerializedDockview } from "dockview-react";
import { isSplit, LayoutNode, LayoutTab, SplitDirection } from "../../../shared/nvm/workbench/layoutSchema";
import { SINGLETON_VIEWS } from "../../../shared/nvm/workbench/viewIds";

type Orientation = "HORIZONTAL" | "VERTICAL";
type GridNode = SerializedDockview["grid"]["root"];
type PanelState = SerializedDockview["panels"][string];

const toOrientation = (d: SplitDirection): Orientation => (d === "horizontal" ? "HORIZONTAL" : "VERTICAL");
const toDirection = (o: Orientation): SplitDirection => (o === "HORIZONTAL" ? "horizontal" : "vertical");
const orthogonal = (o: Orientation): Orientation => (o === "HORIZONTAL" ? "VERTICAL" : "HORIZONTAL");

/** Resolves a display title for a panel instance. */
export type TitleResolver = (tab: LayoutTab, instanceIndex: number) => string;

/** Panel id for a tab: singletons use their view id so they stay unique. */
export function panelIdFor(tab: LayoutTab, counter: Map<string, number>): string {
	if (tab.id) {
		return tab.id;
	}
	if (SINGLETON_VIEWS.has(tab.view)) {
		return tab.view;
	}
	const n = (counter.get(tab.view) ?? 0) + 1;
	counter.set(tab.view, n);
	return `${tab.view}#${n}`;
}

/**
 * Build a dockview layout for a container of `width × height` px. Sizes are
 * emitted in px for that box; dockview then lays the grid out to its real size.
 */
export function toDockview(
	root: LayoutNode,
	width: number,
	height: number,
	resolveTitle: TitleResolver,
): SerializedDockview {
	const panels: Record<string, PanelState> = {};
	const idCounter = new Map<string, number>();
	const instanceCounter = new Map<string, number>();
	let groupSeq = 0;
	let activeGroup: string | undefined;

	const leaf = (node: Extract<LayoutNode, { tabs: unknown }>, size: number): GridNode => {
		const views = node.tabs.map(tab => {
			const id = panelIdFor(tab, idCounter);
			const index = (instanceCounter.get(tab.view) ?? 0) + 1;
			instanceCounter.set(tab.view, index);
			panels[id] = {
				id,
				contentComponent: tab.view,
				title: resolveTitle(tab, index),
				params: { ...(tab.params ?? {}) },
			};
			return id;
		});
		const groupId = `g${++groupSeq}`;
		activeGroup ??= groupId;
		const active = views[node.active ?? 0] ?? views[0];
		return { type: "leaf", data: { views, activeView: active, id: groupId }, size };
	};

	/** `extent` = this node's size along its parent's orientation. */
	const build = (node: LayoutNode, orientation: Orientation, w: number, h: number, extent: number): GridNode => {
		if (!isSplit(node)) {
			return leaf(node, extent);
		}
		const sizes = node.sizes ?? node.children.map(() => 100 / node.children.length);
		const total = sizes.reduce((a, b) => a + b, 0) || 1;
		const data = node.children.map((child, i) => {
			const share = sizes[i] / total;
			const cw = orientation === "HORIZONTAL" ? w * share : w;
			const ch = orientation === "HORIZONTAL" ? h : h * share;
			const childExtent = orientation === "HORIZONTAL" ? cw : ch;
			return build(child, orthogonal(orientation), cw, ch, childExtent);
		});
		return { type: "branch", data, size: extent };
	};

	const rootOrientation: Orientation = isSplit(root) ? toOrientation(root.split) : "HORIZONTAL";
	const rootExtent = rootOrientation === "HORIZONTAL" ? height : width;
	const gridRoot = isSplit(root)
		? build(root, rootOrientation, width, height, rootExtent)
		: { type: "branch" as const, data: [leaf(root, width)], size: rootExtent };

	return {
		grid: { root: gridRoot, width, height, orientation: rootOrientation as SerializedDockview["grid"]["orientation"] },
		panels,
		activeGroup,
	};
}

/**
 * Convert dockview's current layout back to our tree. Sizes become integer
 * percentages so container resizes (which keep proportions) compare equal.
 */
export function fromDockview(json: SerializedDockview): LayoutNode | undefined {
	const panelTab = (id: string): LayoutTab | undefined => {
		const p = json.panels[id];
		if (!p?.contentComponent) {
			return undefined;
		}
		const params = p.params && Object.keys(p.params).length > 0 ? { ...p.params } : undefined;
		const tab: LayoutTab = { view: p.contentComponent };
		if (params) {
			tab.params = params;
		}
		if (!SINGLETON_VIEWS.has(p.contentComponent)) {
			tab.id = id;
		}
		return tab;
	};

	const convert = (node: GridNode, orientation: Orientation): LayoutNode | undefined => {
		if (node.type === "leaf") {
			const group = node.data as { views: string[]; activeView?: string };
			const tabs = group.views.map(panelTab).filter((t): t is LayoutTab => !!t);
			if (tabs.length === 0) {
				return undefined;
			}
			const activeIndex = group.activeView ? group.views.indexOf(group.activeView) : 0;
			return activeIndex > 0 ? { tabs, active: activeIndex } : { tabs };
		}
		const children = node.data as GridNode[];
		const converted: LayoutNode[] = [];
		const sizes: number[] = [];
		for (const child of children) {
			const c = convert(child, orthogonal(orientation));
			if (c) {
				converted.push(c);
				sizes.push(child.size ?? 1);
			}
		}
		if (converted.length === 0) {
			return undefined;
		}
		if (converted.length === 1) {
			return converted[0];
		}
		const total = sizes.reduce((a, b) => a + b, 0) || 1;
		return {
			split: toDirection(orientation),
			sizes: sizes.map(s => Math.max(1, Math.round((s / total) * 100))),
			children: converted,
		};
	};

	return convert(json.grid.root, json.grid.orientation as Orientation);
}
