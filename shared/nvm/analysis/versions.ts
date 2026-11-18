// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Version (write-history) helpers over the generic block properties
 * `identity` / `sequence` / `isLatest`. Many NVM layouts keep several copies
 * of a logical block (redundant / historical / stale instances); grouping by
 * identity and ordering by sequence reconstructs its write history, and
 * diffing consecutive decoded trees shows WHAT changed on each write.
 */

import type { NvmBlockInfo } from "../../protocol";
import { flattenLeaves, nodeDisplay, nodeScalar } from "../skills/paths";

/** Logical key of a block (identity, else its name, else its id). */
export function identityKey(b: NvmBlockInfo): string {
	return b.identity?.key ?? b.name ?? b.id;
}

/** Sort ascending by write order; unknown sequence first, then by offset. */
export function bySequence(a: NvmBlockInfo, b: NvmBlockInfo): number {
	const sa = a.sequence ?? Number.NEGATIVE_INFINITY;
	const sb = b.sequence ?? Number.NEGATIVE_INFINITY;
	return sa === sb ? a.offset - b.offset : sa < sb ? -1 : 1;
}

/** identity key → versions (oldest → newest). */
export function groupVersions(blocks: readonly NvmBlockInfo[]): Map<string, NvmBlockInfo[]> {
	const out = new Map<string, NvmBlockInfo[]>();
	for (const b of blocks) {
		const k = identityKey(b);
		const list = out.get(k);
		if (list) {
			list.push(b);
		} else {
			out.set(k, [b]);
		}
	}
	for (const list of out.values()) {
		list.sort(bySequence);
	}
	return out;
}

/** The newest instance in a version list (explicit `isLatest` wins). */
export function latestOf(versions: readonly NvmBlockInfo[]): NvmBlockInfo | undefined {
	return versions.find(v => v.isLatest) ?? versions[versions.length - 1];
}

/** Only the newest instance of every identity. */
export function latestBlocks(blocks: readonly NvmBlockInfo[]): NvmBlockInfo[] {
	const out: NvmBlockInfo[] = [];
	for (const versions of groupVersions(blocks).values()) {
		const l = latestOf(versions);
		if (l) {
			out.push(l);
		}
	}
	return out;
}

export interface FieldChange {
	path: string;
	before: string;
	after: string;
	/** Numeric delta when both sides are numbers. */
	delta?: number;
}

/** Leaf-level diff between two decoded trees (paths present in either side). */
export function diffDecoded(
	older: NvmBlockInfo | undefined,
	newer: NvmBlockInfo,
	maxChanges = 200,
): { changes: FieldChange[]; truncated: boolean } {
	const a = flattenLeaves(older?.decoded);
	const b = flattenLeaves(newer.decoded);
	const changes: FieldChange[] = [];
	let truncated = false;
	const paths = new Set([...a.keys(), ...b.keys()]);
	for (const p of paths) {
		const na = a.get(p);
		const nb = b.get(p);
		const da = na ? nodeDisplay(na) : "∅";
		const db = nb ? nodeDisplay(nb) : "∅";
		if (da === db) {
			continue;
		}
		if (changes.length >= maxChanges) {
			truncated = true;
			break;
		}
		const sa = nodeScalar(na);
		const sb = nodeScalar(nb);
		changes.push({
			path: p,
			before: da,
			after: db,
			delta: typeof sa === "number" && typeof sb === "number" ? sb - sa : undefined,
		});
	}
	return { changes, truncated };
}
