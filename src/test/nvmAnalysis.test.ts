/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { blockScope } from "../../shared/nvm/analysis/blockScope";
import { buildTimeline, writeCorrelation } from "../../shared/nvm/analysis/timeline";
import { diffDecoded, groupVersions, latestBlocks } from "../../shared/nvm/analysis/versions";
import { computeBindings } from "../../shared/nvm/skills/match";
import { parseSkill } from "../../shared/nvm/skills/meta";
import { evaluatePredicate, PredicateError, PredicateScope } from "../../shared/nvm/skills/predicate";
import { checkSkills } from "../../shared/nvm/skills/rules";
import { NvmDecodedNode } from "../../shared/nvm/structRich";
import { NvmBlockInfo } from "../../shared/protocol";

const scope = (vars: Record<string, number | string | boolean>, lists: Record<string, (number | string)[]> = {}): PredicateScope => ({
	value: p => vars[p],
	values: p => lists[p] ?? (p in vars ? [vars[p] as number] : []),
});

const leaf = (name: string, value: number): NvmDecodedNode => ({ name, type: "u16", offset: 0, length: 2, value });

/** Vendor-neutral synthetic block with a write sequence and identity. */
function blk(name: string, seq: number | undefined, fields: Record<string, number> = {}, identity?: string): NvmBlockInfo {
	return {
		id: `${name}@${seq}`,
		name,
		offset: (seq ?? 0) * 0x10,
		length: 0x10,
		sequence: seq,
		identity: { key: identity ?? name, label: name },
		decoded: Object.entries(fields).map(([k, v]) => leaf(k, v)),
	};
}

describe("NVM analysis: predicate evaluator", () => {
	it("supports comparison, logic, arithmetic and bit ops", () => {
		const s = scope({ A: 5, B: 3, Status: 0x0b });
		expect(evaluatePredicate("A > B && A + B == 8", s)).to.equal(true);
		expect(evaluatePredicate("(Status & 0x08) != 0", s)).to.equal(true);
		expect(evaluatePredicate("bit(Status, 2)", s)).to.equal(0);
		expect(evaluatePredicate("not (A < B) and B >= 3", s)).to.equal(true);
		expect(evaluatePredicate("min(A, B) * 2", s)).to.equal(6);
	});

	it("aggregates over path matches", () => {
		const s = scope({}, { "H[]": [1, 2, 3] });
		expect(evaluatePredicate("count(H[]) == 3 && sum(H[]) == 6 && exists(H[])", s)).to.equal(true);
		expect(evaluatePredicate("exists(Missing[])", s)).to.equal(false);
	});

	it("short-circuits so guarded access is safe, and errors on unknown fields", () => {
		const s = scope({ A: 0 });
		expect(evaluatePredicate("A != 0 && Unknown > 1", s)).to.equal(false);
		expect(() => evaluatePredicate("Unknown > 1", s)).to.throw(PredicateError);
	});

	it("compares strings case-insensitively and numeric strings numerically", () => {
		const s = scope({ L: "WATCHDOG", N: "0x10" });
		expect(evaluatePredicate("L == 'watchdog'", s)).to.equal(true);
		expect(evaluatePredicate("N == 16", s)).to.equal(true);
	});

	it("compares enum labels and parses slot numbers from names", () => {
		const b: NvmBlockInfo = {
			id: "x",
			name: "Rec_Slot2",
			offset: 0,
			length: 4,
			decoded: [{ name: "State", type: "u32", offset: 0, length: 4, value: 2, enumLabel: "STATE_VALID" }, leaf("Idx", 5)],
		};
		const s = blockScope({ self: b });
		expect(evaluatePredicate("label(State) == 'STATE_VALID' && glob(label(State), 'state_*')", s)).to.equal(true);
		expect(evaluatePredicate("Idx % 3 == trailingNumber($name)", s)).to.equal(true);
		expect(() => evaluatePredicate("label(Missing) == 'x'", s)).to.throw(PredicateError);
	});

	it("resolves self/other paths and block metadata", () => {
		const a = blk("A", 4, { X: 7 });
		const b = blk("B", 9, { Y: 7 });
		const s = blockScope({ self: a, other: b });
		expect(evaluatePredicate("self.X == other.Y && $sequence < other.$sequence", s)).to.equal(true);
	});
});

describe("NVM analysis: versions + timeline", () => {
	const blocks = [
		blk("Cnt", 1, { N: 1 }, "cnt"),
		blk("Other", 2, {}, "o"),
		blk("Cnt", 3, { N: 2 }, "cnt"),
		blk("Mirror", 4, { N: 2 }, "m"),
		blk("Cnt", 7, { N: 5 }, "cnt"),
		blk("NoSeq", undefined),
	];

	it("groups versions oldest→newest and diffs them", () => {
		const v = groupVersions(blocks).get("cnt")!;
		expect(v.map(b => b.sequence)).to.deep.equal([1, 3, 7]);
		expect(latestBlocks(blocks).filter(b => b.identity?.key === "cnt")[0].sequence).to.equal(7);
		const d = diffDecoded(v[1], v[2]);
		expect(d.changes).to.deep.equal([{ path: "N", before: "2", after: "5", delta: 3 }]);
	});

	it("orders writes and windows around a block", () => {
		const t = buildTimeline(blocks);
		expect(t.total).to.equal(5);
		expect(t.unsequenced).to.equal(1);
		const w = buildTimeline(blocks, { around: "Mirror", window: 1 });
		expect(w.entries.map(e => e.sequence)).to.deep.equal([3, 4, 7]);
		const latest = buildTimeline(blocks, { match: ["Cnt"], latestOnly: true });
		expect(latest.entries.map(e => e.sequence)).to.deep.equal([7]);
	});

	it("correlates writes of two families", () => {
		const c = writeCorrelation(blocks, "Cnt", "Mirror", 1);
		expect(c.aWrites).to.equal(3);
		// Distance is in write RANKS: Cnt@3 → Mirror right after, Cnt@7 right after Mirror.
		expect(c.coWritten).to.equal(2);
		expect(c.bAfter).to.equal(1);
		expect(c.bBefore).to.equal(1);
		expect(c.orphans).to.deep.equal([1]);
	});
});

describe("NVM analysis: skill rules + relations", () => {
	const meta = parseSkill({
		dirName: "cnt",
		dir: "mem://cnt",
		scope: "user",
		text: [
			"---",
			"name: cnt",
			"kind: block",
			"description: counter",
			"appliesTo:",
			"  blocks: [Cnt]",
			"rules:",
			"  - id: small",
			"    expr: N < 4",
			"  - id: broken",
			"    expr: Nope > 1",
			"relations:",
			"  - id: mirror",
			"    kind: value",
			"    with: Mirror",
			"    expr: self.N == other.N",
			"  - id: before-mirror",
			"    kind: order",
			"    with: Mirror",
			"    expect: before",
			"  - id: needs-ghost",
			"    kind: presence",
			"    with: Ghost*",
			"---",
		].join("\n"),
	}).meta!;

	const blocks = [blk("Cnt", 1, { N: 1 }, "cnt"), blk("Mirror", 4, { N: 2 }, "m"), blk("Cnt", 7, { N: 5 }, "cnt")];

	it("reports failures with evidence and never throws", () => {
		const r = checkSkills([meta], computeBindings([meta], blocks), blocks);
		const byId = Object.fromEntries(r.findings.map(f => [f.id, f]));
		expect(byId.small.status).to.equal("fail"); // latest N = 5
		expect(byId.broken.status).to.equal("error");
		expect(byId.mirror.status).to.equal("fail"); // 5 != 2
		expect(byId["before-mirror"].status).to.equal("fail"); // latest Cnt (7) after Mirror (4)
		expect(byId["before-mirror"].detail).to.match(/seq 7/);
		expect(byId["needs-ghost"].status).to.equal("fail");
		expect(r.counts.fail).to.equal(4);
	});
});
