// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Vendor-neutral at-a-glance summary of a parsed dump, computed only from the
 * generic {@link NvmBlockInfo} fields (group / identity / sequence / isLatest).
 * Backs the workbench Overview panel; pure so it can also feed AI answers.
 */

import { NvmBlockInfo } from "../../protocol";

export interface GroupCount {
	key: string;
	label: string;
	count: number;
}

export interface IdentityVersions {
	key: string;
	label: string;
	versions: number;
	/** The newest instance (by sequence, else isLatest, else highest offset). */
	latest: NvmBlockInfo;
}

export interface DumpSummary {
	totalBlocks: number;
	/** Blocks flagged as the newest instance of their identity. */
	latestBlocks: number;
	/** Distinct logical identities (blocks without identity count individually). */
	identities: number;
	/** Blocks carrying a decoded value tree. */
	decodedBlocks: number;
	groups: GroupCount[];
	/** Identities with the most stored versions (most frequently rewritten). */
	mostRewritten: IdentityVersions[];
	/** The most recently written block (highest sequence), if order is known. */
	newest?: NvmBlockInfo;
}

const TOP_REWRITTEN = 5;

const newer = (a: NvmBlockInfo, b: NvmBlockInfo): NvmBlockInfo => {
	if (a.sequence !== undefined && b.sequence !== undefined) {
		return a.sequence >= b.sequence ? a : b;
	}
	if (a.isLatest !== b.isLatest) {
		return a.isLatest ? a : b;
	}
	return a.offset >= b.offset ? a : b;
};

export function summarizeBlocks(blocks: readonly NvmBlockInfo[]): DumpSummary {
	const groups = new Map<string, GroupCount & { order: number }>();
	const identities = new Map<string, { label: string; versions: number; latest: NvmBlockInfo }>();
	let latestBlocks = 0;
	let decodedBlocks = 0;
	let newest: NvmBlockInfo | undefined;

	for (const block of blocks) {
		if (block.isLatest) {
			latestBlocks++;
		}
		if (block.decoded?.length) {
			decodedBlocks++;
		}
		if (block.sequence !== undefined) {
			newest = newest ? newer(newest, block) : block;
		}
		if (block.group) {
			const g = groups.get(block.group.key);
			if (g) {
				g.count++;
			} else {
				groups.set(block.group.key, {
					key: block.group.key,
					label: block.group.label,
					count: 1,
					order: block.group.order ?? Number.MAX_SAFE_INTEGER,
				});
			}
		}
		const idKey = block.identity?.key ?? `block:${block.id}`;
		const existing = identities.get(idKey);
		if (existing) {
			existing.versions++;
			existing.latest = newer(existing.latest, block);
		} else {
			identities.set(idKey, {
				label: block.identity?.label ?? block.name ?? block.id,
				versions: 1,
				latest: block,
			});
		}
	}

	const mostRewritten = [...identities.entries()]
		.filter(([, v]) => v.versions > 1)
		.sort((a, b) => b[1].versions - a[1].versions)
		.slice(0, TOP_REWRITTEN)
		.map(([key, v]) => ({ key, label: v.label, versions: v.versions, latest: v.latest }));

	return {
		totalBlocks: blocks.length,
		latestBlocks,
		identities: identities.size,
		decodedBlocks,
		groups: [...groups.values()]
			.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
			.map(({ key, label, count }) => ({ key, label, count })),
		mostRewritten,
		newest,
	};
}
