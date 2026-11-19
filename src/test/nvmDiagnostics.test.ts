/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { buildConfigNodes } from "../nvm/diagnostics/dumpConfigModel";
import { explainLoad } from "../nvm/diagnostics/explainLoad";
import { NvmLoadDiagnosis } from "../nvm/diagnostics/loadDiagnostics";
import { parseOffsetQuery, unifiedSearch } from "../../shared/nvm/views/unifiedSearch";
import { NvmAnnotationsView, NvmBlockInfo } from "../../shared/protocol";

const blocks: NvmBlockInfo[] = [
	{
		id: "b1",
		name: "ResetCounter",
		offset: 0x100,
		length: 16,
		attributes: [{ key: "status", label: "Status", value: "valid" }],
		decoded: [
			{ name: "Reason", type: "enum", offset: 0x104, length: 1, value: 4, enumLabel: "WATCHDOG" },
			{ name: "Count", type: "u32", offset: 0x108, length: 4, value: 7 },
		],
	},
	{ id: "b2", name: "Odometer", offset: 0x200, length: 8, attributes: [{ key: "status", label: "Status", value: "invalid" }] },
];

const annotations: NvmAnnotationsView = {
	tags: [{ id: "t1", label: "suspicious" }],
	badges: [],
	assignments: [{ id: "a1", tagId: "t1", start: 0x200, end: 0x208 }],
	notes: [{ id: "n1", start: 0x104, end: 0x105, title: "Watchdog reset after flash" }],
	bookmarks: [{ id: "bm1", offset: 0x100, label: "first reset" }],
};

const diagnosis = (patch: Partial<NvmLoadDiagnosis>): NvmLoadDiagnosis => ({
	fileName: "dump.mot",
	dir: "/d",
	status: "noBlocks",
	descriptors: [],
	sources: [],
	blockCount: 0,
	updatedAt: 0,
	...patch,
});

describe("NVM search & diagnostics", () => {
	describe("unified search", () => {
		it("parses address queries", () => {
			expect(parseOffsetQuery("0x1A")).to.equal(0x1a);
			expect(parseOffsetQuery("200h")).to.equal(0x200);
			expect(parseOffsetQuery("Reset")).to.equal(undefined);
		});

		it("finds an address and its owning block", () => {
			const hits = unifiedSearch("0x104", blocks, annotations);
			expect(hits[0]).to.deep.include({ kind: "address", offset: 0x104, detail: "in ResetCounter" });
		});

		it("matches block names, attribute values, decoded enum labels and annotations", () => {
			expect(unifiedSearch("odometer", blocks, annotations).map(h => h.kind)).to.include("block");
			expect(unifiedSearch("invalid", blocks, annotations).find(h => h.kind === "block")?.label).to.equal("Odometer");
			const field = unifiedSearch("watchdog", blocks, annotations).find(h => h.kind === "field");
			expect(field).to.deep.include({ label: "ResetCounter › Reason", offset: 0x104 });
			const notes = unifiedSearch("watchdog", blocks, annotations).filter(h => h.kind === "annotation");
			expect(notes.map(h => h.offset)).to.deep.equal([0x104]);
			expect(unifiedSearch("suspicious", blocks, annotations)[0]).to.deep.include({ kind: "annotation", offset: 0x200 });
		});

		it("returns nothing for an empty query", () => {
			expect(unifiedSearch("  ", blocks, annotations)).to.deep.equal([]);
		});
	});

	describe("load explanation", () => {
		it("tells the user where to put a descriptor when none was found", () => {
			const e = explainLoad(diagnosis({ status: "noDescriptor" }));
			expect(e.headline).to.contain("No *.nvmlayout.json");
			expect(e.nextSteps.join(" ")).to.contain("/d/conf");
		});

		it("puts missing required sources and engine problems first", () => {
			const e = explainLoad(
				diagnosis({
					descriptors: [{ name: "X", via: 'engine "x"', usesEngine: true }],
					sources: [{ logical: "cfg", file: "Cfg.c", resolved: false, required: true }],
					engineIssue: 'Engine pack "x" is not installed.',
				}),
			);
			expect(e.nextSteps[0]).to.contain("Cfg.c");
			expect(e.nextSteps[1]).to.contain("not installed");
		});

		it("reports success with the block count", () => {
			expect(explainLoad(diagnosis({ status: "loaded", blockCount: 12, providerId: "p" })).headline).to.contain("12 NVM blocks");
		});
	});

	describe("Dump & Config nodes", () => {
		const env = { layoutMode: "workbench" as const, enginesAllowed: true, workspaceTrusted: true };

		it("marks a missing required source as an error with a fix command", () => {
			const nodes = buildConfigNodes(
				diagnosis({ sources: [{ logical: "cfg", file: "Cfg.c", resolved: false, required: true }] }),
				env,
			);
			const sources = nodes.find(n => n.id === "sources")!;
			expect(sources.state).to.equal("error");
			expect(sources.children![0].command?.id).to.equal("nvmStudio.nvm.reselectDependency");
		});

		it("shows an engine that did not run", () => {
			const nodes = buildConfigNodes(
				diagnosis({ descriptors: [{ name: "X", via: "engine", usesEngine: true }], engineIssue: "Engine blocked: workspace not trusted." }),
				env,
			);
			expect(nodes.find(n => n.id === "engine")).to.deep.include({ state: "error", description: "did not run" });
		});
	});
});
