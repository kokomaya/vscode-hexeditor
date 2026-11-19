// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Pure flattening of a block tree into visible rows for a virtual list. */

import { BlockNode } from "../../../../../shared/nvm/views/blockTreeModel";
import { NvmBlockInfo } from "../../../../../shared/protocol";

export type TreeRow =
	| { kind: "group"; key: string; label: string; description?: string; depth: number; expanded: boolean }
	| { kind: "block"; block: NvmBlockInfo; depth: number };

export function flattenTree(nodes: readonly BlockNode[], expanded: ReadonlySet<string>, depth = 0): TreeRow[] {
	const rows: TreeRow[] = [];
	for (const node of nodes) {
		if (node.kind === "block") {
			rows.push({ kind: "block", block: node.block, depth });
			continue;
		}
		const isOpen = expanded.has(node.key);
		rows.push({
			kind: "group",
			key: node.key,
			label: node.label,
			description: node.description,
			depth,
			expanded: isOpen,
		});
		if (isOpen) {
			rows.push(...flattenTree(node.children, expanded, depth + 1));
		}
	}
	return rows;
}

/** Keys of the groups on the path to the block with `blockId` (to auto-expand). */
export function groupPathTo(nodes: readonly BlockNode[], blockId: string): string[] | undefined {
	for (const node of nodes) {
		if (node.kind === "block") {
			if (node.block.id === blockId) {
				return [];
			}
			continue;
		}
		const inner = groupPathTo(node.children, blockId);
		if (inner) {
			return [node.key, ...inner];
		}
	}
	return undefined;
}
