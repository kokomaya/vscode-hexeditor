/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { LayoutConfig } from "../nvm/layout/provider";
import { srecordImageProvider } from "../nvm/layout/srecordImage";
import { structuredLayoutProvider } from "../nvm/layout/structuredLayout";
import { validateLayout } from "../../shared/nvm/workbench/layoutSchema";
import { sceneMatches } from "../../shared/nvm/workbench/sceneMatch";
import { summarizeBlocks } from "../../shared/nvm/views/dumpSummary";
import { NvmBlockInfo } from "../../shared/protocol";

/** The shipped sample must keep parsing into a meaningful, vendor-neutral model. */
describe("NVM sample dump", () => {
	const dir = path.resolve(__dirname, "..", "samples", "basic-log");
	const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

	const parse = (): NvmBlockInfo[] => {
		const text = read("sample-nvm.mot");
		const config = JSON.parse(read("sample.nvmlayout.json")) as LayoutConfig;
		const dump = { fileName: "sample-nvm.mot", ext: ".mot", text };
		const image = srecordImageProvider.provide(dump)!;
		const ctx = { fileName: dump.fileName, ext: dump.ext, image, configs: [config], sources: {}, symbols: () => undefined };
		expect(structuredLayoutProvider.detect(ctx as never)).to.equal(true);
		return structuredLayoutProvider.parse(ctx as never);
	};

	it("parses blocks with identity, write order, latest flags and attributes", () => {
		const blocks = parse();
		expect(blocks.length).to.be.greaterThan(20);
		expect(blocks.every(b => b.identity && b.sequence !== undefined && b.attributes?.length)).to.equal(true);
		const summary = summarizeBlocks(blocks);
		expect(summary.identities).to.equal(4);
		expect(summary.latestBlocks).to.equal(4);
	});

	it("flags exactly one CRC mismatch and never marks it latest", () => {
		const bad = parse().filter(b => b.attributes?.some(a => a.key === "crc" && a.value === "mismatch"));
		expect(bad).to.have.length(1);
		expect(bad[0].isLatest).to.equal(false);
	});

	it("ships a valid scenario layout that matches the sample", () => {
		const r = validateLayout(JSON.parse(read("write-history.nvmworkbench.json")));
		expect(r.ok).to.equal(true);
		if (r.ok) {
			expect(sceneMatches(r.layout, parse())).to.equal(true);
		}
	});
});
