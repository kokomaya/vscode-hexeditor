// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Decoded-tree path helpers shared by skills (field docs, rules, relations)
 * and the analysis tools. Path syntax:
 *
 *   `a.b`        nested field
 *   `arr[3].x`   one array element
 *   `arr[].x`    every element (wildcard)
 *
 * The struct decoder names array elements `arr[i]` inside an `array` wrapper
 * node called `arr`; canonical paths therefore read `arr[i]`, never `arr.arr[i]`.
 */

import type { NvmDecodedNode } from "../structRich";

/** Visit every node with its canonical path (`a.b`, `arr[2].x`). */
export function walkPaths(
	nodes: readonly NvmDecodedNode[] | undefined,
	visit: (node: NvmDecodedNode, path: string) => void,
	prefix = "",
	parentIsArray = false,
): void {
	for (const n of nodes ?? []) {
		const path = parentIsArray ? `${prefix}${n.name}` : prefix ? `${prefix}.${n.name}` : n.name;
		visit(n, path);
		if (n.children?.length) {
			const isArray = n.type === "array";
			// Array elements sit beside the wrapper's own prefix (`arr[i]`, not `arr.arr[i]`).
			const childPrefix = isArray ? (prefix ? (parentIsArray ? prefix : `${prefix}.`) : "") : path;
			walkPaths(n.children, visit, childPrefix, isArray);
		}
	}
}

/** `arr[3].x` → `arr[].x` (the wildcard form used as a field-doc key). */
export function wildcardPath(path: string): string {
	return path.replace(/\[\d+\]/g, "[]");
}

/** Convert a user path into a matcher over canonical paths. */
function pathMatcher(path: string): (candidate: string) => boolean {
	const norm = path.trim();
	if (!norm.includes("[]")) {
		const lower = norm.toLowerCase();
		return c => c.toLowerCase() === lower;
	}
	const re = new RegExp(
		`^${norm
			.split("[]")
			.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("\\[\\d+\\]")}$`,
		"i",
	);
	return c => re.test(c);
}

/**
 * Resolve a path to matching nodes. When an exact path finds nothing and the
 * path is a single bare name, falls back to the first node with that name
 * anywhere in the tree (convenient for flat-ish structs).
 */
export function resolvePath(nodes: readonly NvmDecodedNode[] | undefined, path: string): NvmDecodedNode[] {
	const match = pathMatcher(path);
	const out: NvmDecodedNode[] = [];
	walkPaths(nodes, (n, p) => {
		if (match(p)) {
			out.push(n);
		}
	});
	if (out.length === 0 && /^[A-Za-z_$][\w$]*$/.test(path.trim())) {
		const lower = path.trim().toLowerCase();
		walkPaths(nodes, n => {
			if (out.length === 0 && n.name.toLowerCase() === lower) {
				out.push(n);
			}
		});
	}
	return out;
}

export type Scalar = number | string | boolean;

/** Best scalar for comparisons: numeric physical value, else raw, else label. */
export function nodeScalar(node: NvmDecodedNode | undefined): Scalar | undefined {
	if (!node) {
		return undefined;
	}
	const v = node.value;
	if (typeof v === "number" || typeof v === "boolean") {
		return v;
	}
	if (typeof v === "string") {
		const n = Number(v);
		if (v.trim() !== "" && Number.isFinite(n)) {
			return n;
		}
		// A display-formatted value ("0x0F - 15", "1.2.3 RELEASE") → compare on the raw number.
		if (typeof node.raw === "number") {
			return node.raw;
		}
		return v;
	}
	if (typeof node.raw === "number") {
		return node.raw;
	}
	if (typeof node.raw === "string") {
		const n = Number(node.raw);
		return Number.isFinite(n) ? n : node.raw;
	}
	return node.enumLabel;
}

/** Display text for a node (enum label wins, then value, then hex). */
export function nodeDisplay(node: NvmDecodedNode | undefined): string {
	if (!node) {
		return "∅";
	}
	const v = node.value !== undefined ? String(node.value) : (node.hex ?? (node.raw !== undefined ? String(node.raw) : node.type));
	const label = node.enumLabel !== undefined && node.enumLabel !== v ? ` (${node.enumLabel})` : "";
	return `${v}${label}${node.unit ? ` ${node.unit}` : ""}`;
}

/** Flatten a decoded tree into `path → leaf node` (leaves only, capped). */
export function flattenLeaves(
	nodes: readonly NvmDecodedNode[] | undefined,
	max = 5000,
): Map<string, NvmDecodedNode> {
	const out = new Map<string, NvmDecodedNode>();
	walkPaths(nodes, (n, p) => {
		if (out.size < max && !n.children?.length) {
			out.set(p, n);
		}
	});
	return out;
}
