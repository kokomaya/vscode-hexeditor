// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Write-order timeline and write-correlation analysis over the generic
 * `sequence` hint. Answers "what was written in which order", "what was
 * written right before/after X" and "is B always written together with A".
 * Blocks without a sequence are excluded from ordering (reported separately).
 */

import type { NvmBlockInfo } from "../../protocol";
import { globMatch } from "../skills/match";
import { bySequence, groupVersions, identityKey } from "./versions";

export interface TimelineEntry {
	/** 0-based rank in write order among sequenced blocks. */
	rank: number;
	sequence: number;
	name: string;
	identity: string;
	offset: number;
	length: number;
	/** 1-based version number of this write within its identity. */
	version: number;
	versions: number;
	isLatest: boolean;
	group?: string;
}

export interface TimelineOptions {
	/** Name globs (OR). Empty = all blocks. */
	match?: string[];
	/** Center the window on the newest write of this block (name glob/substring). */
	around?: string;
	/** Entries before/after `around` (default 10). */
	window?: number;
	/** Keep only the newest instance per identity. */
	latestOnly?: boolean;
	/** Newest first instead of oldest first. */
	newestFirst?: boolean;
	limit?: number;
	offset?: number;
}

export interface Timeline {
	entries: TimelineEntry[];
	/** Sequenced blocks matching the filter (before paging). */
	total: number;
	/** Blocks with no sequence hint (cannot be ordered). */
	unsequenced: number;
	hasMore: boolean;
	/** Rank of the `around` anchor, when requested and found. */
	anchorRank?: number;
}

const nameOf = (b: NvmBlockInfo) => b.name ?? b.id;

/** Glob when it has wildcards, else case-insensitive substring. */
export function nameMatches(pattern: string, b: NvmBlockInfo): boolean {
	const p = pattern.trim();
	if (!p) {
		return true;
	}
	if (/[*?]/.test(p)) {
		return globMatch(p, nameOf(b)) || globMatch(p, b.identity?.key);
	}
	const lower = p.toLowerCase();
	return nameOf(b).toLowerCase().includes(lower) || b.id.toLowerCase() === lower;
}

/** Build the (filtered, paged) write-order timeline. */
export function buildTimeline(blocks: readonly NvmBlockInfo[], opts: TimelineOptions = {}): Timeline {
	const versions = groupVersions(blocks);
	const sequenced = blocks.filter(b => typeof b.sequence === "number").slice().sort(bySequence);
	const unsequenced = blocks.length - sequenced.length;

	const toEntry = (b: NvmBlockInfo, rank: number): TimelineEntry => {
		const list = versions.get(identityKey(b)) ?? [b];
		const idx = list.indexOf(b);
		return {
			rank,
			sequence: b.sequence as number,
			name: nameOf(b),
			identity: identityKey(b),
			offset: b.offset,
			length: b.length,
			version: idx + 1,
			versions: list.length,
			isLatest: b.isLatest ?? idx === list.length - 1,
			group: b.group?.label,
		};
	};
	let all = sequenced.map(toEntry);

	if (opts.latestOnly) {
		all = all.filter(e => e.isLatest);
	}
	let anchorRank: number | undefined;
	if (opts.around) {
		const anchor = [...all].reverse().find(e => nameMatches(opts.around!, sequenced[e.rank]));
		if (!anchor) {
			return { entries: [], total: 0, unsequenced, hasMore: false };
		}
		anchorRank = anchor.rank;
		const w = Math.max(1, Math.min(opts.window ?? 10, 200));
		const pos = all.indexOf(anchor);
		all = all.slice(Math.max(0, pos - w), pos + w + 1);
	} else if (opts.match?.length) {
		all = all.filter(e => opts.match!.some(m => nameMatches(m, sequenced[e.rank])));
	}
	if (opts.newestFirst) {
		all.reverse();
	}
	const start = Math.max(0, Math.floor(opts.offset ?? 0));
	const size = Math.max(1, Math.min(Math.floor(opts.limit ?? 100), 500));
	const entries = all.slice(start, start + size);
	return { entries, total: all.length, unsequenced, hasMore: start + entries.length < all.length, anchorRank };
}

export interface CorrelationResult {
	a: string;
	b: string;
	/** Number of A writes considered. */
	aWrites: number;
	bWrites: number;
	/** A writes that had a B write within the window. */
	coWritten: number;
	/** Of those, how many B writes came BEFORE / AFTER the A write. */
	bBefore: number;
	bAfter: number;
	/** Distribution of the nearest distance (in write ranks) A → B. */
	nearest: { distance: number; count: number }[];
	/** Example A writes with no B nearby (sequence numbers). */
	orphans: number[];
}

/**
 * For every write of A, find the nearest write of B (in write-rank distance).
 * Quantifies "B is written together with / before / after A".
 */
export function writeCorrelation(
	blocks: readonly NvmBlockInfo[],
	a: string,
	b: string,
	within = 3,
): CorrelationResult {
	const seq = blocks.filter(x => typeof x.sequence === "number").slice().sort(bySequence);
	const aIdx: number[] = [];
	const bIdx: number[] = [];
	seq.forEach((blk, i) => {
		if (nameMatches(a, blk)) {
			aIdx.push(i);
		}
		if (nameMatches(b, blk)) {
			bIdx.push(i);
		}
	});
	const hist = new Map<number, number>();
	let coWritten = 0;
	let bBefore = 0;
	let bAfter = 0;
	const orphans: number[] = [];
	for (const ai of aIdx) {
		let best: number | undefined;
		for (const bi of bIdx) {
			if (bi === ai) {
				continue;
			}
			const d = bi - ai;
			if (best === undefined || Math.abs(d) < Math.abs(best)) {
				best = d;
			}
		}
		if (best !== undefined && Math.abs(best) <= within) {
			coWritten++;
			if (best < 0) {
				bBefore++;
			} else {
				bAfter++;
			}
			hist.set(best, (hist.get(best) ?? 0) + 1);
		} else if (orphans.length < 20) {
			orphans.push(seq[ai].sequence as number);
		}
	}
	return {
		a,
		b,
		aWrites: aIdx.length,
		bWrites: bIdx.length,
		coWritten,
		bBefore,
		bAfter,
		nearest: [...hist.entries()]
			.map(([distance, count]) => ({ distance, count }))
			.sort((x, y) => Math.abs(x.distance) - Math.abs(y.distance) || x.distance - y.distance),
		orphans,
	};
}
