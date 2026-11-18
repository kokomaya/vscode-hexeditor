/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { parseYamlSubset, splitFrontmatter } from "../../shared/nvm/skills/frontmatter";
import { parseSkill } from "../../shared/nvm/skills/meta";
import { computeBindings, globMatch, skillsByBlock } from "../../shared/nvm/skills/match";
import { parseExplicitSkills, scoreSkills, selectCatalog, tokenize } from "../../shared/nvm/skills/rank";
import { applyBlockSkills } from "../../shared/nvm/skills/apply";
import { checkSkills } from "../../shared/nvm/skills/rules";
import { knowledgeSection, resolveValueDocs } from "../../shared/nvm/skills/knowledge";
import { resolvePath, walkPaths } from "../../shared/nvm/skills/paths";
import { SkillMeta } from "../../shared/nvm/skills/types";
import { NvmDecodedNode } from "../../shared/nvm/structRich";
import { NvmBlockInfo } from "../../shared/protocol";

/** Vendor-neutral synthetic skill. */
function skill(text: string, scope: SkillMeta["scope"] = "user"): SkillMeta {
	const r = parseSkill({ text, dirName: "x", dir: `mem://${scope}/x`, scope });
	if (!r.meta) {
		throw new Error(r.diagnostics.map(d => d.message).join("; "));
	}
	return r.meta;
}

const leaf = (name: string, offset: number, value: number | string, extra?: Partial<NvmDecodedNode>): NvmDecodedNode => ({
	name,
	type: "u16",
	offset,
	length: 2,
	value,
	...extra,
});

describe("NVM skills: frontmatter", () => {
	it("splits frontmatter and body", () => {
		const r = splitFrontmatter("---\na: 1\n---\n# Body\ntext");
		expect(r.frontmatter).to.equal("a: 1\n");
		expect(r.body).to.equal("# Body\ntext");
	});

	it("parses scalars, flow lists/maps, folded text, nested maps and list-of-maps", () => {
		const y = parseYamlSubset(
			[
				"name: demo-skill   # comment",
				"kind: block",
				"description: >",
				"  first line",
				"  second line",
				"keywords: [a, \"b c\", 'd']",
				"priority: 10",
				"enabled: false",
				"appliesTo:",
				"  blocks: [\"Foo*\", Bar?]",
				"  attributes: { section: \"Safe*\" }",
				"fields:",
				"  Counter: { meaning: \"how many\", unit: count }",
				"  Hist[]: { meaning: ring buffer }",
				"rules:",
				"  - id: r1",
				"    expr: \"Counter >= 0\"",
				"  - id: r2",
				"    expr: Counter < 10",
				"list2:",
				"- x",
				"- 0x10",
			].join("\n"),
		);
		expect(y.name).to.equal("demo-skill");
		expect(y.description).to.equal("first line second line");
		expect(y.keywords).to.deep.equal(["a", "b c", "d"]);
		expect(y.priority).to.equal(10);
		expect(y.enabled).to.equal(false);
		expect((y.appliesTo as any).blocks).to.deep.equal(["Foo*", "Bar?"]);
		expect((y.appliesTo as any).attributes).to.deep.equal({ section: "Safe*" });
		expect((y.fields as any)["Hist[]"]).to.deep.equal({ meaning: "ring buffer" });
		expect(y.rules).to.deep.equal([
			{ id: "r1", expr: "Counter >= 0" },
			{ id: "r2", expr: "Counter < 10" },
		]);
		// Hex stays a string (ids), decimals become numbers.
		expect(y.list2).to.deep.equal(["x", "0x10"]);
	});

	it("reports bad indentation with a line number", () => {
		expect(() => parseYamlSubset("a: 1\n   b: 2")).to.throw(/line 2/);
	});

	it("rejects block skills without appliesTo and invalid names", () => {
		const bad = parseSkill({ text: "---\nkind: block\ndescription: d\n---\n", dirName: "x", dir: "d", scope: "user" });
		expect(bad.meta).to.equal(undefined);
		expect(bad.diagnostics[0].message).to.match(/appliesTo/);
		const badName = parseSkill({ text: "---\nname: Bad_Name\nkind: playbook\ndescription: d\n---\n", dirName: "x", dir: "d", scope: "user" });
		expect(badName.meta).to.equal(undefined);
	});

	it("parses playbook composition and relations", () => {
		const s = skill(
			"---\nname: p\nkind: playbook\ndescription: d\nuses: [a, b]\nrelations:\n  - id: o\n    kind: order\n    with: \"B*\"\n    expect: after\n    within: 4\n---\nbody",
		);
		expect(s.uses).to.deep.equal(["a", "b"]);
		expect(s.relations[0]).to.include({ kind: "order", with: "B*", expect: "after", within: 4 });
	});
});

describe("NVM skills: matching", () => {
	const blocks: NvmBlockInfo[] = [
		{ id: "1", name: "Alpha_Info1", offset: 0, length: 4, attributes: [{ key: "section", label: "S", value: "Safe0" }] },
		{ id: "0x0123", name: "Other", offset: 4, length: 4 },
		{ id: "3", name: "Beta", offset: 8, length: 4, identity: { key: "tag:0x31", label: "Beta" } },
	];

	it("globs are case-insensitive and anchored", () => {
		expect(globMatch("alpha_*", "Alpha_Info1")).to.equal(true);
		expect(globMatch("Info", "Alpha_Info1")).to.equal(false);
	});

	it("binds by name / id / identity / attribute (OR) and filters by layout", () => {
		const s = skill(
			"---\nname: b\nkind: block\ndescription: d\nappliesTo:\n  blocks: [\"alpha*\"]\n  ids: [\"0x0123\", \"tag:0x31\"]\n---\n",
		);
		expect(computeBindings([s], blocks).get("b")).to.deep.equal([0, 1, 2]);
		const a = skill("---\nname: a\nkind: block\ndescription: d\nappliesTo:\n  attributes: { section: \"Safe*\" }\n  layout: \"vendor-x\"\n---\n");
		expect(computeBindings([a], blocks).get("a")).to.deep.equal([]);
		expect(computeBindings([a], blocks, { ids: ["vendor-x"] }).get("a")).to.deep.equal([0]);
	});

	it("orders conflicting skills by scope then priority", () => {
		const low = skill("---\nname: low\nkind: block\ndescription: d\nappliesTo:\n  blocks: [Beta]\n---\n", "builtin");
		const high = skill("---\nname: high\nkind: block\ndescription: d\nappliesTo:\n  blocks: [Beta]\n---\n", "workspace");
		const by = skillsByBlock(computeBindings([low, high], blocks), [low, high]);
		expect(by.get(2)!.map(s => s.name)).to.deep.equal(["high", "low"]);
	});
});

describe("NVM skills: ranking", () => {
	const count = skill("---\nname: count-and-statistics\nkind: playbook\ndescription: 计数统计\nkeywords: [多少, how many]\npriority: 10\n---\n");
	const reset = skill("---\nname: ecu-reset-counter\nkind: block\ndescription: 复位计数\nkeywords: [reset, 复位]\nappliesTo:\n  blocks: [R*]\n---\n");
	const other = skill("---\nname: odometer\nkind: block\ndescription: 里程\nkeywords: [odometer, 里程]\nappliesTo:\n  blocks: [O*]\n---\n");

	it("tokenizes mixed CJK/ASCII into words and bigrams", () => {
		const t = tokenize("有多少个reset");
		expect(t.has("reset")).to.equal(true);
		expect(t.has("多少")).to.equal(true);
	});

	it("ranks matching skills for a mixed-language prompt", () => {
		const ranked = scoreSkills("这个 mot 里一共有多少个reset", [count, reset, other]).filter(s => s.score > 0).map(s => s.meta.name);
		expect(ranked).to.include.members(["count-and-statistics", "ecu-reset-counter"]);
		expect(ranked).to.not.include("odometer");
	});

	it("omits unbound block skills and keeps pinned playbooks", () => {
		const cat = selectCatalog("odometer", [count, reset, other], {
			size: 1,
			boundCounts: new Map([["ecu-reset-counter", 1], ["odometer", 0]]),
		});
		expect(cat.map(s => s.name)).to.deep.equal(["count-and-statistics"]);
	});

	it("extracts explicit skill:name directives", () => {
		expect(parseExplicitSkills("skill:abc why skill:x-y?")).to.deep.equal({ names: ["abc", "x-y"], prompt: "why ?" });
	});
});

describe("NVM skills: paths + apply", () => {
	const tree: NvmDecodedNode[] = [
		leaf("Counter", 0x10, 42),
		{
			name: "Hist",
			type: "array",
			offset: 0x12,
			length: 2,
			children: [leaf("Hist[0]", 0x12, 1, { type: "u8", length: 1 }), leaf("Hist[1]", 0x13, 2, { type: "u8", length: 1 })],
		},
	];

	it("walks canonical paths and resolves wildcards", () => {
		const paths: string[] = [];
		walkPaths(tree, (_n, p) => paths.push(p));
		expect(paths).to.deep.equal(["Counter", "Hist", "Hist[0]", "Hist[1]"]);
		expect(resolvePath(tree, "Hist[]").length).to.equal(2);
		expect(resolvePath(tree, "hist[1]")[0].value).to.equal(2);
	});

	it("decodes undecoded blocks (fill) and attaches docs", () => {
		const s = skill(
			"---\nname: b\nkind: block\ndescription: d\nappliesTo:\n  blocks: [Blk]\nstruct: s.json\nstructRoot: S\nfields:\n  Counter: { meaning: total count, unit: count }\n  Hist[]: element\n---\n",
		);
		const blocks: NvmBlockInfo[] = [{ id: "1", name: "Blk", offset: 0x100, length: 4 }];
		const catalog = {
			structs: { S: { name: "S", fields: [{ name: "Counter", type: "u16" as const }, { name: "Hist", type: "u8" as const, dims: [2] }] } },
			enums: {},
		};
		const bytes = new Uint8Array(0x200);
		bytes.set([0x2a, 0x00, 0x01, 0x02], 0x100);
		const r = applyBlockSkills(blocks, [s], computeBindings([s], blocks), {
			applyStructs: true,
			catalogs: new Map([["b", catalog]]),
			read: (o, l) => bytes.subarray(o, o + l),
		});
		expect(r.decoded).to.equal(1);
		const counter = resolvePath(blocks[0].decoded, "Counter")[0];
		expect(counter.value).to.equal(42);
		expect(counter.offset).to.equal(0x100);
		expect(counter.doc).to.deep.include({ meaning: "total count", source: "b" });
		expect(resolvePath(blocks[0].decoded, "Hist[1]")[0].doc?.meaning).to.equal("element");
	});

	it("keeps engine decodes in fill mode", () => {
		const s = skill("---\nname: b\nkind: block\ndescription: d\nappliesTo:\n  blocks: [Blk]\nstruct: s.json\nstructRoot: S\n---\n");
		const blocks: NvmBlockInfo[] = [{ id: "1", name: "Blk", offset: 0, length: 2, decoded: [leaf("Engine", 0, 7)] }];
		applyBlockSkills(blocks, [s], computeBindings([s], blocks), {
			applyStructs: true,
			catalogs: new Map([["b", { structs: { S: { name: "S", fields: [{ name: "X", type: "u16" }] } }, enums: {} }]]),
			read: () => new Uint8Array(2),
		});
		expect(blocks[0].decoded![0].name).to.equal("Engine");
	});
});

describe("NVM skills: config authority + valueDocs", () => {
	it("defaults to fill; override is an explicit opt-in that replaces the config decode", () => {
		const fill = skill("---\nname: f\nkind: block\ndescription: d\nappliesTo:\n  blocks: [X]\n---\n");
		expect(fill.decodeMode).to.equal("fill");
		const s = skill(
			"---\nname: b\nkind: block\ndescription: d\ndecodeMode: override\nappliesTo:\n  blocks: [Blk]\nstruct: s.json\nstructRoot: S\n---\n",
		);
		const blocks: NvmBlockInfo[] = [{ id: "1", name: "Blk", offset: 0, length: 2, decoded: [leaf("Config", 0, 7)] }];
		const r = applyBlockSkills(blocks, [s], computeBindings([s], blocks), {
			applyStructs: true,
			catalogs: new Map([["b", { structs: { S: { name: "S", fields: [{ name: "X", type: "u16" }] } }, enums: {} }]]),
			read: () => new Uint8Array([5, 0]),
		});
		expect(blocks[0].decoded![0].name).to.equal("X");
		expect(r.diagnostics.some(d => d.severity === "warning" && /override/.test(d.message))).to.equal(true);
	});

	it("exposes params to rules", () => {
		const s = skill(
			[
				"---",
				"name: p",
				"kind: block",
				"description: d",
				"appliesTo:",
				"  blocks: [Rec*]",
				"params: { NVM_BLOCKS: 3, MAX: 10 }",
				"rules:",
				"  - id: slot",
				'    expr: "Idx % NVM_BLOCKS == trailingNumber($name) && Idx < MAX"',
				"---",
			].join("\n"),
		);
		expect(s.params).to.deep.equal({ NVM_BLOCKS: 3, MAX: 10 });
		const blocks: NvmBlockInfo[] = [{ id: "1", name: "Rec1", offset: 0, length: 2, decoded: [leaf("Idx", 0, 7)] }];
		const r = checkSkills([s], computeBindings([s], blocks), blocks, { includePass: true });
		expect(r.counts.pass).to.equal(1);
	});

	it("never re-decodes a config-decoded block and reports it", () => {
		const s = skill("---\nname: b\nkind: block\ndescription: d\nappliesTo:\n  blocks: [Blk]\nstruct: s.json\nstructRoot: S\n---\n");
		const blocks: NvmBlockInfo[] = [{ id: "1", name: "Blk", offset: 0, length: 2, decoded: [leaf("Config", 0, 7)] }];
		const r = applyBlockSkills(blocks, [s], computeBindings([s], blocks), {
			applyStructs: true,
			catalogs: new Map([["b", { structs: { S: { name: "S", fields: [{ name: "X", type: "u16" }] } }, enums: {} }]]),
			read: () => new Uint8Array(2),
		});
		expect(blocks[0].decoded![0].name).to.equal("Config");
		expect(r.diagnostics.some(d => /config wins/.test(d.message))).to.equal(true);
	});

	it("parses valueDocs in order, rejects escaping paths, and routes by enum label", () => {
		const r = parseSkill({
			text: [
				"---",
				"name: r",
				"kind: block",
				"description: d",
				"appliesTo:",
				"  blocks: [Rec*]",
				"valueDocs:",
				"  Reason:",
				"    \"R_ECC_*\": reasons/ecc.md",
				"    \"R_EXC*\": \"skill:exception-analysis\"",
				"    \"*\": ../outside.md",
				"---",
			].join("\n"),
			dirName: "r",
			dir: "d",
			scope: "user",
		});
		const meta = r.meta!;
		expect(meta.valueDocs.Reason.map(v => v.doc)).to.deep.equal(["reasons/ecc.md", "skill:exception-analysis"]);
		expect(r.diagnostics.some(d => /outside/.test(d.message))).to.equal(true);
		const block: NvmBlockInfo = {
			id: "1",
			name: "Rec0",
			offset: 0,
			length: 4,
			decoded: [leaf("Reason", 0, 0x4017, { enumLabel: "R_ECC_SRAM" })],
		};
		const routes = resolveValueDocs(block, meta);
		expect(routes).to.deep.equal([{ path: "Reason", display: "16407 (R_ECC_SRAM)", doc: "reasons/ecc.md" }]);
		expect(knowledgeSection(block, [meta])).to.match(/nvm_readSkillResource\("r", "reasons\/ecc.md"\)/);
	});
});
