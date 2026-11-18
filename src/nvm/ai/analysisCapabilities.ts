// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Relational-analysis facade: the generic primitives skills compose to
 * investigate timing (write order), write relationships (versions / co-writes),
 * logic relationships (cross-block expressions) and business invariants.
 * Vendor-blind — it only uses generic block properties and decoded trees —
 * and every result is bounded here.
 */

import { NvmBlockInfo } from "../../../shared/protocol";
import { blockScope } from "../../../shared/nvm/analysis/blockScope";
import {
	buildTimeline,
	CorrelationResult,
	nameMatches,
	Timeline,
	TimelineOptions,
	writeCorrelation,
} from "../../../shared/nvm/analysis/timeline";
import { diffDecoded, FieldChange, groupVersions, identityKey, latestBlocks } from "../../../shared/nvm/analysis/versions";
import { nodeDisplay, resolvePath, Scalar } from "../../../shared/nvm/skills/paths";
import { evaluatePredicate, PredicateError, truthy } from "../../../shared/nvm/skills/predicate";
import { ActiveDump } from "./activeDump";
import { clamp, NvmCapabilityError } from "./capabilityTypes";

const MAX_ROWS = 200;
const MAX_FIELDS = 12;
const MAX_VERSIONS = 50;

export interface VersionEntry {
	name: string;
	sequence?: number;
	offset: number;
	isLatest: boolean;
	changes: FieldChange[];
	changesTruncated: boolean;
}

export interface BlockHistory {
	identity: string;
	totalVersions: number;
	versions: VersionEntry[];
	truncated: boolean;
	decoded: boolean;
}

export interface FieldRow {
	block: string;
	sequence?: number;
	isLatest: boolean;
	values: Record<string, string>;
}

export interface FieldTable {
	fields: string[];
	rows: FieldRow[];
	total: number;
	truncated: boolean;
	/** Rows dropped because the `where` filter could not be evaluated. */
	whereErrors: number;
}

export interface EvalRow {
	block: string;
	partner?: string;
	value?: Scalar;
	pass?: boolean;
	error?: string;
}

export interface EvalResult {
	expr: string;
	rows: EvalRow[];
	counts: { true: number; false: number; error: number };
	truncated: boolean;
}

export class AnalysisCapabilities {
	constructor(private readonly dump: ActiveDump) {}

	private select(pattern: string | undefined, latestOnly: boolean): NvmBlockInfo[] {
		const all = this.dump.blocks();
		const pool = latestOnly ? latestBlocks(all) : all;
		const pats = (pattern ?? "")
			.split(/[,;|]/)
			.map(p => p.trim())
			.filter(Boolean);
		const picked = pats.length ? pool.filter(b => pats.some(p => nameMatches(p, b))) : pool;
		return picked.slice().sort((a, b) => (a.sequence ?? -Infinity) - (b.sequence ?? -Infinity) || a.offset - b.offset);
	}

	private versionCounter(): (b: NvmBlockInfo) => number {
		const groups = groupVersions(this.dump.blocks());
		return b => groups.get(identityKey(b))?.length ?? 1;
	}

	/** Write-order timeline (filter, window around a block, paging). */
	public timeline(opts: TimelineOptions): Timeline {
		return buildTimeline(this.dump.blocks(), opts);
	}

	/** Version chain of one logical block with field-level diffs per write. */
	public blockHistory(name: string, opts: { maxVersions?: number; maxChanges?: number } = {}): BlockHistory {
		const block = this.dump.require(name);
		const key = identityKey(block);
		const versions = groupVersions(this.dump.blocks()).get(key) ?? [block];
		const maxV = clamp(opts.maxVersions ?? 20, 1, MAX_VERSIONS);
		const maxC = clamp(opts.maxChanges ?? 40, 1, 200);
		const shown = versions.slice(-maxV); // newest N
		const firstIdx = versions.length - shown.length;
		return {
			identity: key,
			totalVersions: versions.length,
			truncated: versions.length > shown.length,
			decoded: versions.some(v => v.decoded?.length),
			versions: shown.map((v, i) => {
				const prev = versions[firstIdx + i - 1];
				const d = diffDecoded(prev, v, maxC);
				return {
					name: v.name ?? v.id,
					sequence: v.sequence,
					offset: v.offset,
					isLatest: v.isLatest ?? firstIdx + i === versions.length - 1,
					changes: d.changes,
					changesTruncated: d.truncated,
				};
			}),
		};
	}

	/** Tabulate decoded field values across many blocks (optionally filtered by `where`). */
	public queryFields(opts: { blocks?: string; fields: string[]; where?: string; latestOnly?: boolean; limit?: number }): FieldTable {
		const fields = (opts.fields ?? []).map(f => f.trim()).filter(Boolean).slice(0, MAX_FIELDS);
		if (!fields.length) {
			throw new NvmCapabilityError("queryFields needs at least one field path.");
		}
		const limit = clamp(opts.limit ?? 100, 1, MAX_ROWS);
		const versionCount = this.versionCounter();
		let whereErrors = 0;
		const matched = this.select(opts.blocks, opts.latestOnly !== false).filter(b => {
			if (!opts.where) {
				return true;
			}
			try {
				return truthy(evaluatePredicate(opts.where, blockScope({ self: b, versionCount })));
			} catch {
				whereErrors++;
				return false;
			}
		});
		const rows = matched.slice(0, limit).map(b => {
			const values: Record<string, string> = {};
			for (const f of fields) {
				if (f.startsWith("$")) {
					const v = blockScope({ self: b, versionCount }).value(f);
					values[f] = v === undefined ? "∅" : String(v);
				} else {
					const nodes = resolvePath(b.decoded, f);
					values[f] = nodes.length === 0 ? "∅" : nodes.slice(0, 8).map(nodeDisplay).join(" | ") + (nodes.length > 8 ? " | …" : "");
				}
			}
			return { block: b.name ?? b.id, sequence: b.sequence, isLatest: b.isLatest ?? true, values };
		});
		return { fields, rows, total: matched.length, truncated: matched.length > rows.length, whereErrors };
	}

	/**
	 * Evaluate an ad-hoc expression per block (and optionally per partner
	 * block, `other.*`) — the escape hatch for logic checks no skill declares yet.
	 */
	public evaluate(opts: { expr: string; blocks?: string; other?: string; latestOnly?: boolean; limit?: number }): EvalResult {
		const expr = (opts.expr ?? "").trim();
		if (!expr) {
			throw new NvmCapabilityError("evaluate needs an expression.");
		}
		const latestOnly = opts.latestOnly !== false;
		const selves = this.select(opts.blocks, latestOnly);
		const others = opts.other ? this.select(opts.other, latestOnly) : [undefined];
		const limit = clamp(opts.limit ?? 100, 1, MAX_ROWS);
		const versionCount = this.versionCounter();
		const rows: EvalRow[] = [];
		const counts = { true: 0, false: 0, error: 0 };
		let truncated = false;
		for (const self of selves) {
			for (const other of others) {
				if (other === self) {
					continue;
				}
				const row: EvalRow = { block: self.name ?? self.id, partner: other && (other.name ?? other.id) };
				try {
					row.value = evaluatePredicate(expr, blockScope({ self, other, versionCount }));
					row.pass = truthy(row.value);
					counts[row.pass ? "true" : "false"]++;
				} catch (e) {
					row.error = e instanceof PredicateError ? e.message : String(e);
					counts.error++;
				}
				if (rows.length < limit) {
					rows.push(row);
				} else {
					truncated = true;
				}
			}
		}
		return { expr, rows, counts, truncated };
	}

	/** Quantify the write relationship between two block families. */
	public correlate(a: string, b: string, within?: number): CorrelationResult {
		if (!a?.trim() || !b?.trim()) {
			throw new NvmCapabilityError("correlate needs two block patterns (a and b).");
		}
		return writeCorrelation(this.dump.blocks(), a, b, clamp(within ?? 3, 1, 1000));
	}
}
