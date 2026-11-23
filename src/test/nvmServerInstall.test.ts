/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { bindingFor, installTargets, planInstall, ServerCatalog } from "../../shared/nvm/install/installPlan";
import { configFileUrl, parseConfigListing } from "../../shared/nvm/install/remoteConfigs";
import { findEngine, parseEngineListing, parseEngineRef } from "../../shared/nvm/install/remoteEngines";
import { normalizeServerBase } from "../../shared/nvm/install/serverAddress";
import { parseSkillListing } from "../../shared/nvm/skills/remoteSkills";
import { createEngineSdk } from "../nvm/layout/engineSdk";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServer } = require("../../server/index.js");

const repo = path.resolve(__dirname, "..");
const demoRoot = path.join(repo, "server", "demo");
/** docs/features/skill-templates copied into the demo at the radar product level. */
const APP_SKILLS = ["reset-record", "reset-exception-analysis", "dem-event-memory", "reset-dtc-investigation"];

const engine = (id: string, extra: Record<string, unknown> = {}) => ({ id, files: ["engine.json", "engine.js"], ...extra });

describe("NVM install server — client side", () => {
	it("accepts a bare IP / host as the server address", () => {
		expect(normalizeServerBase("10.1.2.3")).to.equal("http://10.1.2.3:7788");
		expect(normalizeServerBase(" nvm-server:8080 ")).to.equal("http://nvm-server:8080");
		expect(normalizeServerBase("https://nvm.corp/x/")).to.equal("https://nvm.corp/x");
		expect(normalizeServerBase("http://10.1.2.3")).to.equal("http://10.1.2.3");
		expect(normalizeServerBase("ftp://x")).to.equal(undefined);
		expect(normalizeServerBase("")).to.equal(undefined);
	});

	it("validates the engine listing (vendor / layout folders only)", () => {
		const { engines } = parseEngineListing({
			engines: [
				engine("vector/fee-v3", { manifestId: "vector-fee-v3", version: "1.2.0" }),
				engine("eb"),
				engine("../evil"),
				engine("a/b/c"),
				engine("x/y", { files: ["engine.json", "../../steal.js"] }),
				engine("x/z", { files: ["engine.js"] }),
			],
		});
		expect(engines.map(e => e.id)).to.deep.equal(["vector/fee-v3", "eb"]);
		expect(parseEngineRef("vector/fee-v3@1.2.0")).to.deep.equal(["vector", "fee-v3"]);
		expect(findEngine(engines, "vector/fee-v3")?.version).to.equal("1.2.0");
		expect(findEngine(engines, "vector-fee-v3")?.id, "legacy manifest id").to.equal("vector/fee-v3");
		expect(findEngine(engines, "vector/fee-v4")).to.equal(undefined);
	});

	it("validates the config listing and keeps old-server download URLs only for old servers", () => {
		const configs = parseConfigListing({
			configs: [
				{ path: "radar/chipA/customerB/x.nvmlayout.json", engines: ["vector/fee-v3"], downloadUrl: "http://elsewhere/x" },
				{ name: "legacy.nvmlayout.json", downloadUrl: "http://old/v1/configs/legacy.nvmlayout.json" },
				{ path: "../x.nvmlayout.json" },
				{ path: "a/readme.md" },
			],
		});
		expect(configs.map(c => c.path)).to.deep.equal(["radar/chipA/customerB/x.nvmlayout.json", "legacy.nvmlayout.json"]);
		expect(configFileUrl("http://s:1", configs[0])).to.equal("http://s:1/v1/configs/file?path=radar%2FchipA%2FcustomerB%2Fx.nvmlayout.json");
		expect(configFileUrl("http://s:1", configs[1])).to.equal("http://old/v1/configs/legacy.nvmlayout.json");
	});

	const catalog = (): ServerCatalog => ({
		engines: parseEngineListing({ engines: [engine("vector/fee-v3"), engine("vector/fee-v4"), engine("eb/fee")] }),
		configs: parseConfigListing({
			configs: [
				{ path: "radar/chipA/customerB/b.nvmlayout.json", engines: ["vector/fee-v3"] },
				{ path: "radar/chipA/customerC/c.nvmlayout.json", engines: ["eb/fee"], skillContext: "radar/chipA/customerC" },
				{ path: "camera/x.nvmlayout.json", engines: [] },
			],
		}),
		skills: parseSkillListing({
			skills: [
				{ name: "general", path: [], files: ["SKILL.md"] },
				{ name: "platform-tip", path: ["radar", "chipA"], files: ["SKILL.md"] },
				{ name: "b-blocks", path: ["radar", "chipA", "customerB"], files: ["SKILL.md"] },
				{ name: "cam", path: ["camera"], files: ["SKILL.md"] },
			],
			levels: [
				{ path: ["radar"], title: "雷达" },
				{ path: ["radar", "chipA"], engines: ["vector/fee-v3"] },
				{ path: ["radar", "chipA", "customerB"], configs: ["radar/chipA/customerB/b.nvmlayout.json"] },
				{ path: ["radar", "chipA", "customerC"], engines: ["vector/fee-v4"] },
				{ path: ["radar", "chipA", "customerD"], configs: ["radar/chipA/customerD/gone.nvmlayout.json"], engines: ["vector/fee-v9"] },
			],
		}),
	});

	it("inherits the binding down the hierarchy; the nearest level wins per field", () => {
		const levels = catalog().skills.levels;
		const b = bindingFor(levels, ["radar", "chipA", "customerB"]);
		expect(b.engines).to.deep.equal(["vector/fee-v3"]);
		expect(b.enginesFrom).to.deep.equal(["radar", "chipA"]);
		expect(b.configs).to.deep.equal(["radar/chipA/customerB/b.nvmlayout.json"]);
		expect(bindingFor(levels, ["radar", "chipA", "customerC"]).engines, "project override").to.deep.equal(["vector/fee-v4"]);
		expect(bindingFor(levels, ["radar"]).engines).to.deep.equal([]);
	});

	it("plans exactly what a project needs", () => {
		const b = planInstall(catalog(), ["radar", "chipA", "customerB"]);
		expect(b.engines.map(e => e.id)).to.deep.equal(["vector/fee-v3"]);
		expect(b.configs.map(c => c.path)).to.deep.equal(["radar/chipA/customerB/b.nvmlayout.json"]);
		expect(b.skills.map(s => s.name)).to.deep.equal(["general", "platform-tip", "b-blocks"]);
		expect(b.missing).to.deep.equal([]);

		// customerC: binding engine fee-v4 + the eb engine of the descriptor that declares this skillContext.
		const c = planInstall(catalog(), ["radar", "chipA", "customerC"]);
		expect(c.engines.map(e => e.id)).to.deep.equal(["vector/fee-v4", "eb/fee"]);
		expect(c.configs.map(x => x.path)).to.deep.equal(["radar/chipA/customerC/c.nvmlayout.json"]);

		const d = planInstall(catalog(), ["radar", "chipA", "customerD"]);
		expect(d.missing).to.deep.equal(["conf radar/chipA/customerD/gone.nvmlayout.json", "engine vector/fee-v9"]);

		const all = planInstall(catalog());
		expect([all.engines.length, all.configs.length, all.skills.length]).to.deep.equal([3, 3, 4]);
	});

	it("lists every product / platform / project as an install target", () => {
		const targets = installTargets(catalog());
		expect(targets.map(t => t.context.join("/"))).to.include.members(["radar", "radar/chipA", "radar/chipA/customerB", "camera"]);
		const b = targets.find(t => t.context.join("/") === "radar/chipA/customerB")!;
		expect(b.title).to.equal("雷达 › chipA › customerB");
		expect(b.skills).to.equal(3);
	});
});

describe("NVM install server — demo data root end to end", () => {
	let server: { close(): void; address(): { port: number } };
	let base = "";
	before(done => {
		server = createServer(demoRoot).listen(0, "127.0.0.1", () => {
			base = `http://127.0.0.1:${server.address().port}`;
			done();
		});
	});
	after(() => server.close());

	const getJson = async (p: string) => (await fetch(base + p)).json();

	it("serves a catalog whose customerB project resolves to the demo engine, its descriptor and skills", async () => {
		const cat: ServerCatalog = {
			engines: parseEngineListing(await getJson("/v1/engines")),
			configs: parseConfigListing(await getJson("/v1/configs")),
			skills: parseSkillListing(await getJson("/v1/skills")),
		};
		expect(cat.engines.vendors.map(v => v.id)).to.include("vector");
		const plan = planInstall(cat, ["radar", "chipA", "customerB"]);
		expect(plan.engines.map(e => e.id)).to.deep.equal(["demo-vendor/log-v1"]);
		expect(plan.configs.map(c => c.path)).to.deep.equal(["radar/chipA/customerB/sample.nvmlayout.json"]);
		expect(plan.skills.map(s => s.id)).to.have.members([...APP_SKILLS.map(s => `radar/${s}`), "radar/chipA/reset-reasons", "radar/chipA/customerB/sample-blocks"]);
		expect(plan.missing).to.deep.equal([]);

		// The radar product itself binds the Vector engine + struct descriptor (present once sync-engines.mjs ran).
		const radar = planInstall(cat, ["radar"]);
		expect(radar.skills.map(s => s.name)).to.have.members(APP_SKILLS);
		expect([...radar.engines.map(e => e.id), ...radar.missing]).to.satisfy((xs: string[]) => xs.some(x => x.includes("vector/fee-v3")));
	});

	it("ships the application-layer skill templates unchanged in the demo", () => {
		const files = (dir: string): string[] =>
			fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? files(path.join(dir, d.name)).map(f => `${d.name}/${f}`) : [d.name]));
		for (const skill of APP_SKILLS) {
			const src = path.join(repo, "docs/features/skill-templates", skill);
			const demo = path.join(demoRoot, "skills/radar", skill);
			expect(files(demo).sort(), skill).to.deep.equal(files(src).sort());
			for (const f of files(src)) {
				expect(fs.readFileSync(path.join(demo, f), "utf8"), `${skill}/${f} — re-copy from docs/features/skill-templates`).to.equal(fs.readFileSync(path.join(src, f), "utf8"));
			}
		}
	});

	it("rejects path traversal and refuses to publish over a vendor folder", async () => {
		expect((await fetch(`${base}/v1/engines/file?engine=..%2Fconf&path=x`)).status).to.equal(400);
		expect((await fetch(`${base}/v1/configs/file?path=..%2Fskills%2Fradar%2Flevel.json`)).status).to.equal(400);
		const res = await fetch(`${base}/v1/admin/engines?engine=vector`, { method: "POST", body: "{}" });
		expect(res.status, "no admin token configured").to.equal(403);
	});

	it("the demo engine parses the sample dump with the project's block names", () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("../../server/demo/engines/demo-vendor/log-v1/log.engine.js");
		const descriptor = JSON.parse(fs.readFileSync(path.join(demoRoot, "conf/radar/chipA/customerB/sample.nvmlayout.json"), "utf8"));
		const text = fs.readFileSync(path.join(repo, "samples/basic-log/sample-nvm.mot"), "utf8");
		const blocks = mod.createEngine(createEngineSdk()).parse({ text }, descriptor.options);
		const names = new Set(blocks.map((b: { name: string }) => b.name));
		expect([...names].sort()).to.deep.equal(["Calibration", "DtcMemory", "Odometer", "ResetCounter"]);
		const bad = blocks.filter((b: { attributes: { key: string; value: unknown }[] }) => b.attributes.some(a => a.key === "crc" && a.value === "mismatch"));
		expect(bad.map((b: { name: string }) => b.name)).to.deep.equal(["Calibration"]);
		expect(blocks.filter((b: { isLatest: boolean }) => b.isLatest)).to.have.length(4);
	});
});
