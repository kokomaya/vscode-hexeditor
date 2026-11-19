// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * One search box for everything in a dump: an address, block names / ids,
 * attribute values, decoded field names and values (including enum labels),
 * and annotations (bookmarks, notes, tags). Pure and vendor-neutral; results
 * carry the editor offset to reveal.
 */

import { nodeValueText } from "../customView";
import { NvmDecodedNode } from "../structRich";
import { NvmAnnotationsView, NvmBlockInfo } from "../../protocol";
import { blockLabel, hexOffset } from "./blockTreeModel";

export type SearchHitKind = "address" | "block" | "field" | "annotation";

export interface SearchHit {
	kind: SearchHitKind;
	label: string;
	detail?: string;
	offset: number;
}

export interface SearchOptions {
	/** Max hits per kind (default 8). */
	perKind?: number;
	/** Upper bound on decoded nodes visited (keeps typing responsive). */
	maxNodes?: number;
}

const DEFAULT_PER_KIND = 8;
const DEFAULT_MAX_NODES = 50_000;

/** Parse "0x1A2B", "1A2Bh" or a bare hex string of 3+ digits as an offset. */
export function parseOffsetQuery(query: string): number | undefined {
	const q = query.trim();
	const m = /^0x([0-9a-f]+)$/i.exec(q) ?? /^([0-9a-f]+)h$/i.exec(q) ?? /^([0-9a-f]{3,})$/i.exec(q);
	if (!m) {
		return undefined;
	}
	const n = parseInt(m[1], 16);
	return Number.isFinite(n) ? n : undefined;
}

function ownerOf(blocks: readonly NvmBlockInfo[], offset: number): NvmBlockInfo | undefined {
	return blocks.find(b => offset >= b.offset && offset < b.offset + b.length);
}

function searchFields(
	block: NvmBlockInfo,
	needle: string,
	out: SearchHit[],
	limit: number,
	budget: { nodes: number },
): void {
	const walk = (nodes: readonly NvmDecodedNode[] | undefined, path: string) => {
		for (const node of nodes ?? []) {
			if (out.length >= limit || budget.nodes-- <= 0) {
				return;
			}
			const fieldPath = path ? `${path}.${node.name}` : node.name;
			if (node.children?.length) {
				walk(node.children, fieldPath);
				continue;
			}
			const value = node.enumLabel ? `${node.enumLabel} (${nodeValueText(node)})` : nodeValueText(node);
			if (node.name.toLowerCase().includes(needle) || value.toLowerCase().includes(needle)) {
				out.push({ kind: "field", label: `${blockLabel(block)} › ${fieldPath}`, detail: value, offset: node.offset });
			}
		}
	};
	walk(block.decoded, "");
}

export function unifiedSearch(
	query: string,
	blocks: readonly NvmBlockInfo[],
	annotations: NvmAnnotationsView | undefined,
	opts: SearchOptions = {},
): SearchHit[] {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return [];
	}
	const perKind = opts.perKind ?? DEFAULT_PER_KIND;
	const hits: SearchHit[] = [];

	const offset = parseOffsetQuery(query);
	if (offset !== undefined) {
		const owner = ownerOf(blocks, offset);
		hits.push({
			kind: "address",
			label: `Go to ${hexOffset(offset)}`,
			detail: owner ? `in ${blockLabel(owner)}` : undefined,
			offset,
		});
	}

	const blockHits: SearchHit[] = [];
	for (const b of blocks) {
		if (blockHits.length >= perKind) {
			break;
		}
		const label = blockLabel(b);
		const attr = (b.attributes ?? []).find(a => String(a.value).toLowerCase().includes(needle));
		if (label.toLowerCase().includes(needle) || b.id.toLowerCase().includes(needle) || attr) {
			blockHits.push({
				kind: "block",
				label,
				detail: attr && !label.toLowerCase().includes(needle) ? `${attr.label}: ${attr.value}` : hexOffset(b.offset),
				offset: b.offset,
			});
		}
	}
	hits.push(...blockHits);

	const fieldHits: SearchHit[] = [];
	const budget = { nodes: opts.maxNodes ?? DEFAULT_MAX_NODES };
	for (const b of blocks) {
		if (fieldHits.length >= perKind || budget.nodes <= 0) {
			break;
		}
		searchFields(b, needle, fieldHits, perKind, budget);
	}
	hits.push(...fieldHits);

	if (annotations) {
		const tagLabel = new Map(annotations.tags.map(t => [t.id, t.label]));
		const candidates: SearchHit[] = [
			...annotations.bookmarks.map(bm => ({ kind: "annotation" as const, label: `Bookmark: ${bm.label ?? hexOffset(bm.offset)}`, offset: bm.offset })),
			...annotations.notes.map(n => ({ kind: "annotation" as const, label: `Note: ${n.title ?? (n.body ?? "").slice(0, 60)}`, detail: n.body, offset: n.start })),
			...annotations.assignments.map(a => ({ kind: "annotation" as const, label: `Tag: ${tagLabel.get(a.tagId) ?? a.tagId}`, detail: hexOffset(a.start), offset: a.start })),
		];
		hits.push(
			...candidates
				.filter(h => `${h.label} ${h.detail ?? ""}`.toLowerCase().includes(needle))
				.slice(0, perKind)
				.map(h => ({ ...h, detail: h.detail && h.detail.length > 80 ? `${h.detail.slice(0, 80)}…` : h.detail })),
		);
	}
	return hits;
}
