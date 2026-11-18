// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * LM tools for relational analysis: timeline, block history, cross-block
 * field queries, ad-hoc expressions and write correlation. Thin adapters over
 * {@link AnalysisCapabilities}.
 */

import * as vscode from "vscode";
import { guarded, hex, LmApi } from "./lmToolKit";
import { NvmCapabilities } from "./nvmCapabilities";

export function registerAnalysisTools(lm: LmApi, caps: NvmCapabilities): vscode.Disposable[] {
	const a = caps.analysis;
	return [
		lm.registerTool<{
			match?: string[];
			around?: string;
			window?: number;
			latestOnly?: boolean;
			newestFirst?: boolean;
			limit?: number;
			offset?: number;
		}>("nvm_timeline", {
			invoke: async o =>
				guarded(() => {
					const t = a.timeline(o.input ?? {});
					if (!t.total) {
						return t.unsequenced
							? `No ordered writes match. ${t.unsequenced} block(s) carry no write-order hint (sequence), so their order is unknown.`
							: "No blocks match.";
					}
					const lines = t.entries.map(e => {
						const mark = e.rank === t.anchorRank ? "▶" : " ";
						const ver = e.versions > 1 ? ` v${e.version}/${e.versions}${e.isLatest ? " latest" : ""}` : "";
						return `${mark} #${e.rank} seq ${e.sequence} ${e.name}${ver} @ ${hex(e.offset)}${e.group ? ` [${e.group}]` : ""}`;
					});
					const more = t.hasMore ? "\n(more — page with offset)" : "";
					const unseq = t.unsequenced ? `\n(${t.unsequenced} block(s) have no sequence hint and are not ordered)` : "";
					return `Write timeline (${t.total} writes, ${o.input?.newestFirst ? "newest" : "oldest"} first):\n${lines.join("\n")}${more}${unseq}`;
				}),
		}),
		lm.registerTool<{ name: string; maxVersions?: number; maxChanges?: number }>("nvm_blockHistory", {
			invoke: async o =>
				guarded(() => {
					const h = a.blockHistory(o.input?.name ?? "", o.input ?? {});
					const out = [`History of ${h.identity}: ${h.totalVersions} version(s)${h.truncated ? " (showing newest)" : ""}${h.decoded ? "" : " — no decoded data, only write order"}`];
					for (const v of h.versions) {
						out.push(`- ${v.name} seq ${v.sequence ?? "?"} @ ${hex(v.offset)}${v.isLatest ? " (latest)" : ""}`);
						for (const c of v.changes) {
							out.push(`    ${c.path}: ${c.before} → ${c.after}${c.delta !== undefined ? ` (Δ ${c.delta > 0 ? "+" : ""}${c.delta})` : ""}`);
						}
						if (v.changesTruncated) {
							out.push("    … more changes");
						}
					}
					return out.join("\n");
				}),
		}),
		lm.registerTool<{ blocks?: string; fields: string[]; where?: string; latestOnly?: boolean; limit?: number }>(
			"nvm_queryFields",
			{
				invoke: async o =>
					guarded(() => {
						const t = a.queryFields({ fields: [], ...(o.input ?? {}) });
						if (!t.rows.length) {
							return `No blocks match${t.whereErrors ? ` (${t.whereErrors} skipped: 'where' not evaluable on them)` : ""}.`;
						}
						const header = `| block | seq | ${t.fields.join(" | ")} |`;
						const sep = `|${" --- |".repeat(t.fields.length + 2)}`;
						const rows = t.rows.map(r => `| ${r.block}${r.isLatest ? "" : " (old)"} | ${r.sequence ?? "?"} | ${t.fields.map(f => r.values[f]).join(" | ")} |`);
						const notes = [
							t.truncated ? `showing ${t.rows.length} of ${t.total}` : `${t.total} row(s)`,
							t.whereErrors ? `${t.whereErrors} block(s) skipped (where not evaluable)` : "",
						].filter(Boolean);
						return `${header}\n${sep}\n${rows.join("\n")}\n(${notes.join("; ")})`;
					}),
			},
		),
		lm.registerTool<{ expr: string; blocks?: string; other?: string; latestOnly?: boolean; limit?: number }>(
			"nvm_evaluate",
			{
				invoke: async o =>
					guarded(() => {
						const r = a.evaluate({ expr: "", ...(o.input ?? {}) });
						const lines = r.rows.map(x => {
							const who = x.partner ? `${x.block} ↔ ${x.partner}` : x.block;
							return x.error ? `? ${who}: ${x.error}` : `${x.pass ? "✓" : "✗"} ${who}: ${String(x.value)}`;
						});
						return `${r.expr}\ntrue ${r.counts.true}, false ${r.counts.false}, error ${r.counts.error}${r.truncated ? " (rows truncated)" : ""}\n${lines.join("\n")}`;
					}),
			},
		),
		lm.registerTool<{ a: string; b: string; within?: number }>("nvm_correlateWrites", {
			invoke: async o =>
				guarded(() => {
					const c = a.correlate(o.input?.a ?? "", o.input?.b ?? "", o.input?.within);
					if (!c.aWrites) {
						return `No sequenced writes of "${c.a}" found.`;
					}
					const dist = c.nearest.map(n => `${n.distance > 0 ? "+" : ""}${n.distance}:${n.count}`).join(", ");
					return [
						`"${c.a}" writes: ${c.aWrites}, "${c.b}" writes: ${c.bWrites}`,
						`co-written within window: ${c.coWritten}/${c.aWrites} (B before A: ${c.bBefore}, B after A: ${c.bAfter})`,
						`nearest-distance histogram (B rank − A rank : count): ${dist || "none"}`,
						c.orphans.length ? `A writes without B nearby (seq): ${c.orphans.join(", ")}` : "",
					]
						.filter(Boolean)
						.join("\n");
				}),
		}),
	];
}
