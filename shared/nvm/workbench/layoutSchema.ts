// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The workbench layout file format (`*.nvmworkbench.json`, skill `layouts/`,
 * built-in presets, AI-generated layouts). Deliberately our own small tree
 * format — not a dock library's JSON — so it stays hand-writable, AI-writable
 * and independent of the library used to render it.
 *
 *   split "horizontal" = children side by side (left → right)
 *   split "vertical"   = children stacked     (top → bottom)
 */

export type WorkbenchMode = "workbench" | "classic";

export type SplitDirection = "horizontal" | "vertical";

export interface LayoutTab {
	/** Workbench view id (see `viewIds.ts`). */
	view: string;
	/** View-specific parameters (e.g. table filter). */
	params?: Record<string, unknown>;
	/** Optional stable instance id (multi-instance views). */
	id?: string;
}

export interface LayoutTabs {
	tabs: LayoutTab[];
	/** Index of the initially active tab. */
	active?: number;
}

export interface LayoutSplit {
	split: SplitDirection;
	/** Relative sizes (any positive numbers; normalized to percentages). */
	sizes?: number[];
	children: LayoutNode[];
}

export type LayoutNode = LayoutTabs | LayoutSplit;

export interface WorkbenchLayout {
	version: 1;
	id: string;
	name: string;
	/** Capabilities the layout needs (e.g. "layout" = parsed NVM blocks). */
	requires?: string[];
	/** Optional auto-recommendation condition. */
	when?: { anyBlockMatches?: string };
	root: LayoutNode;
}

export const isSplit = (node: LayoutNode): node is LayoutSplit =>
	(node as LayoutSplit).split !== undefined;

export type ValidationResult =
	| { ok: true; layout: WorkbenchLayout }
	| { ok: false; error: string };

const MAX_DEPTH = 8;
const MAX_TABS = 32;

function validateNode(input: unknown, path: string, depth: number, tabCount: { n: number }): string | LayoutNode {
	if (depth > MAX_DEPTH) {
		return `${path}: layout nested deeper than ${MAX_DEPTH}`;
	}
	if (!input || typeof input !== "object") {
		return `${path}: expected an object`;
	}
	const node = input as Record<string, unknown>;
	if (node.split !== undefined) {
		if (node.split !== "horizontal" && node.split !== "vertical") {
			return `${path}.split: must be "horizontal" or "vertical"`;
		}
		if (!Array.isArray(node.children) || node.children.length === 0) {
			return `${path}.children: must be a non-empty array`;
		}
		const children: LayoutNode[] = [];
		for (let i = 0; i < node.children.length; i++) {
			const child = validateNode(node.children[i], `${path}.children[${i}]`, depth + 1, tabCount);
			if (typeof child === "string") {
				return child;
			}
			children.push(child);
		}
		let sizes: number[] | undefined;
		if (node.sizes !== undefined) {
			if (
				!Array.isArray(node.sizes) ||
				node.sizes.length !== children.length ||
				!node.sizes.every(s => typeof s === "number" && Number.isFinite(s) && s > 0)
			) {
				return `${path}.sizes: must be positive numbers, one per child`;
			}
			sizes = node.sizes as number[];
		}
		return { split: node.split, sizes, children };
	}
	if (!Array.isArray(node.tabs) || node.tabs.length === 0) {
		return `${path}: must have either "split" + "children" or a non-empty "tabs" array`;
	}
	const tabs: LayoutTab[] = [];
	for (let i = 0; i < node.tabs.length; i++) {
		const t = node.tabs[i] as Record<string, unknown> | undefined;
		if (!t || typeof t.view !== "string") {
			return `${path}.tabs[${i}].view: must be a string`;
		}
		if (t.params !== undefined && (typeof t.params !== "object" || t.params === null)) {
			return `${path}.tabs[${i}].params: must be an object`;
		}
		if (++tabCount.n > MAX_TABS) {
			return `layout has more than ${MAX_TABS} tabs`;
		}
		tabs.push({
			view: t.view,
			params: t.params as Record<string, unknown> | undefined,
			id: typeof t.id === "string" ? t.id : undefined,
		});
	}
	const active = typeof node.active === "number" ? node.active : undefined;
	return { tabs, active };
}

/** Validate an untrusted layout (file / AI output). Never throws. */
export function validateLayout(input: unknown): ValidationResult {
	if (!input || typeof input !== "object") {
		return { ok: false, error: "layout must be an object" };
	}
	const raw = input as Record<string, unknown>;
	if (raw.version !== undefined && raw.version !== 1) {
		return { ok: false, error: `unsupported layout version ${String(raw.version)}` };
	}
	const root = validateNode(raw.root, "root", 0, { n: 0 });
	if (typeof root === "string") {
		return { ok: false, error: root };
	}
	const requires = Array.isArray(raw.requires)
		? raw.requires.filter((r): r is string => typeof r === "string")
		: undefined;
	const whenRaw = raw.when as Record<string, unknown> | undefined;
	const when =
		whenRaw && typeof whenRaw.anyBlockMatches === "string"
			? { anyBlockMatches: whenRaw.anyBlockMatches }
			: undefined;
	return {
		ok: true,
		layout: {
			version: 1,
			id: typeof raw.id === "string" && raw.id ? raw.id : "custom",
			name: typeof raw.name === "string" && raw.name ? raw.name : "Custom",
			requires,
			when,
			root,
		},
	};
}

/** All tabs of a layout in document order. */
export function layoutTabs(node: LayoutNode): LayoutTab[] {
	return isSplit(node) ? node.children.flatMap(layoutTabs) : node.tabs;
}
