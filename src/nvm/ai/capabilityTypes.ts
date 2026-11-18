// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Types shared by every AI capability facade (kept separate to avoid import cycles). */

/** A bounded, self-describing page so the model knows whether to fetch more. */
export interface Page<T> {
	items: T[];
	/** Total matches before paging. */
	total: number;
	/** How many items this page returned. */
	returned: number;
	/** The offset this page started at. */
	offset: number;
	/** Whether more items exist beyond this page. */
	hasMore: boolean;
}

/**
 * Raised for invalid capability input (bad range, missing anchor, empty note).
 * Tools catch it and surface `message` to the model as a normal tool result.
 */
export class NvmCapabilityError extends Error {}

export function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** Slice a list into a bounded {@link Page}. */
export function toPage<T>(all: T[], offset = 0, limit = 100, maxPage = 500): Page<T> {
	const start = Math.max(0, Math.floor(offset));
	const size = Math.min(Math.max(1, Math.floor(limit)), maxPage);
	const items = all.slice(start, start + size);
	return { items, total: all.length, returned: items.length, offset: start, hasMore: start + items.length < all.length };
}
