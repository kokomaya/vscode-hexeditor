// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The "Annotations" part of the analysis report: notes (with their bodies),
 * bookmarks and tag assignments, each placed on the block that owns it so a
 * reader can follow the report without the editor. Pure Markdown rendering.
 */

import { NvmBlockInfo } from "../../../shared/protocol";
import { Anchor, AnnotationSet } from "../annotations/model";

export const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
export const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function rangeText(a: Anchor): string {
	return a.endOffset && a.endOffset > a.offset + 1 ? `${hex(a.offset)}–${hex(a.endOffset)}` : hex(a.offset);
}

/** The block containing `offset` (the latest instance wins over older copies). */
export function ownerOf(offset: number, blocks: readonly NvmBlockInfo[]): NvmBlockInfo | undefined {
	let best: NvmBlockInfo | undefined;
	for (const b of blocks) {
		if (offset >= b.offset && offset < b.offset + Math.max(1, b.length)) {
			if (!best || (b.isLatest && !best.isLatest) || b.length < best.length) {
				best = b;
			}
		}
	}
	return best;
}

const ownerName = (a: Anchor, blocks: readonly NvmBlockInfo[]) => {
	const b = ownerOf(a.offset, blocks);
	return b ? b.name ?? b.id : "—";
};

/** Drop the heading the note template starts with (it repeats the title). */
function noteBody(body: string): string {
	return body.replace(/^\s*#\s+[^\n]*\n+/, "").trim();
}

export function annotationSections(
	set: AnnotationSet,
	blocks: readonly NvmBlockInfo[],
	noteBodies: ReadonlyMap<string, string>,
): string[] {
	const total = set.notes.length + set.bookmarks.length + set.tagAssignments.length;
	const lines: string[] = ["## Annotations", ""];
	if (total === 0) {
		lines.push("_No bookmarks, notes or tags yet._", "");
		return lines;
	}
	lines.push(
		`_${set.notes.length} note(s) · ${set.bookmarks.length} bookmark(s) · ${set.tagAssignments.length} tag assignment(s)_`,
		"",
	);

	if (set.notes.length) {
		lines.push("### Notes", "");
		for (const note of [...set.notes].sort((a, b) => a.anchor.offset - b.anchor.offset)) {
			lines.push(`#### ${cell(note.title ?? "Note")}`, "");
			lines.push(`\`${rangeText(note.anchor)}\` · in **${cell(ownerName(note.anchor, blocks))}**`, "");
			const body = noteBody(noteBodies.get(note.id) ?? note.body ?? "");
			lines.push(body || "_(empty note)_", "");
		}
	}

	if (set.bookmarks.length) {
		lines.push("### Bookmarks", "", "| Bookmark | Offset | Block |", "| --- | --- | --- |");
		for (const bm of [...set.bookmarks].sort((a, b) => a.anchor.offset - b.anchor.offset)) {
			lines.push(`| ${cell(bm.label ?? "Bookmark")} | ${rangeText(bm.anchor)} | ${cell(ownerName(bm.anchor, blocks))} |`);
		}
		lines.push("");
	}

	if (set.tagAssignments.length) {
		const tagLabel = new Map(set.tags.map(t => [t.id, t.label]));
		lines.push("### Tags", "", "| Tag | Range | Block |", "| --- | --- | --- |");
		const sorted = [...set.tagAssignments].sort(
			(a, b) => (tagLabel.get(a.tagId) ?? "").localeCompare(tagLabel.get(b.tagId) ?? "") || a.anchor.offset - b.anchor.offset,
		);
		for (const a of sorted) {
			lines.push(`| ${cell(tagLabel.get(a.tagId) ?? a.tagId)} | ${rangeText(a.anchor)} | ${cell(ownerName(a.anchor, blocks))} |`);
		}
		lines.push("");
	}
	return lines;
}
