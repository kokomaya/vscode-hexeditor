// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Bridges a block (and optionally a partner block) to the predicate
 * evaluator. Identifiers resolve to:
 *
 * - decoded field paths of `self` (bare: `Counter`, `self.Counter`) or the
 *   partner (`other.Counter`);
 * - generic block metadata: `$sequence`, `$offset`, `$length`, `$isLatest`,
 *   `$id`, `$name`, `$identity`, `$versions`, `$attr.<key>` (also `other.$…`).
 *
 * Vendor-blind: only generic {@link NvmBlockInfo} properties are exposed.
 */

import type { NvmBlockInfo } from "../../protocol";
import type { PredicateScope } from "../skills/predicate";
import { nodeScalar, resolvePath, Scalar } from "../skills/paths";

export interface BlockScopeInput {
	self: NvmBlockInfo;
	other?: NvmBlockInfo;
	/** Count of versions (same identity) per block, if known. */
	versionCount?: (b: NvmBlockInfo) => number;
	/** Extra named constants (e.g. `$now`, user variables). */
	vars?: Record<string, Scalar>;
}

function metaValue(b: NvmBlockInfo, key: string, input: BlockScopeInput): Scalar | undefined {
	switch (key) {
		case "$sequence":
			return b.sequence;
		case "$offset":
			return b.offset;
		case "$length":
			return b.length;
		case "$isLatest":
			return b.isLatest ?? undefined;
		case "$id":
			return b.id;
		case "$name":
			return b.name ?? b.id;
		case "$identity":
			return b.identity?.key;
		case "$versions":
			return input.versionCount?.(b);
		case "$group":
			return b.group?.key;
	}
	if (key.startsWith("$attr.")) {
		const a = b.attributes?.find(x => x.key.toLowerCase() === key.slice(6).toLowerCase());
		return a?.value;
	}
	return undefined;
}

/** Split `self.x` / `other.x` / `x` into (block, path). */
function target(path: string, input: BlockScopeInput): { block?: NvmBlockInfo; rest: string } {
	if (path.startsWith("other.")) {
		return { block: input.other, rest: path.slice(6) };
	}
	if (path.startsWith("self.")) {
		return { block: input.self, rest: path.slice(5) };
	}
	return { block: input.self, rest: path };
}

/** Build a {@link PredicateScope} over one block (+ optional partner). */
export function blockScope(input: BlockScopeInput): PredicateScope {
	return {
		value(path) {
			if (input.vars && path in input.vars) {
				return input.vars[path];
			}
			const { block, rest } = target(path, input);
			if (!block) {
				return undefined;
			}
			if (rest.startsWith("$")) {
				return metaValue(block, rest, input);
			}
			return nodeScalar(resolvePath(block.decoded, rest)[0]);
		},
		label(path) {
			if (input.vars && path in input.vars) {
				return String(input.vars[path]);
			}
			const { block, rest } = target(path, input);
			if (!block) {
				return undefined;
			}
			if (rest.startsWith("$")) {
				const v = metaValue(block, rest, input);
				return v === undefined ? undefined : String(v);
			}
			const node = resolvePath(block.decoded, rest)[0];
			if (!node) {
				return undefined;
			}
			const v = node.enumLabel ?? nodeScalar(node);
			return v === undefined ? undefined : String(v);
		},
		values(path) {
			if (input.vars && path in input.vars) {
				return [input.vars[path]];
			}
			const { block, rest } = target(path, input);
			if (!block) {
				return [];
			}
			if (rest.startsWith("$")) {
				const v = metaValue(block, rest, input);
				return v === undefined ? [] : [v];
			}
			return resolvePath(block.decoded, rest)
				.map(nodeScalar)
				.filter((v): v is Scalar => v !== undefined);
		},
	};
}
