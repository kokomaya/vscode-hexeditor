/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import {
	hierarchyContexts,
	levelOf,
	parseHierarchyPath,
	resolveHierarchy,
	visibleIn,
} from "../../shared/nvm/skills/hierarchy";

const skill = (name: string, path: string) => ({ name, hierarchy: path ? path.split("/") : [], id: `${path}/${name}` });

const skills = [
	skill("reset-counter", ""),
	skill("reset-counter", "radar"),
	skill("reset-counter", "radar/chipA"),
	skill("reset-counter", "radar/chipA/customerB"),
	skill("dem-events", "radar/chipA/customerC"),
	skill("dem-events", "radar/chipA/customerB"),
	skill("odometer", "camera"),
	skill("flash-layout", "radar/chipB"),
];

describe("NVM skill hierarchy", () => {
	it("parses product/platform/project contexts", () => {
		expect(parseHierarchyPath("radar/chipA/customerB")).to.deep.equal(["radar", "chipA", "customerB"]);
		expect(parseHierarchyPath("雷达/芯片A")).to.deep.equal(["雷达", "芯片A"]);
		expect(parseHierarchyPath("")).to.deep.equal([]);
		expect(parseHierarchyPath("a/b/c/d")).to.equal(undefined);
		expect(parseHierarchyPath("../x")).to.equal(undefined);
		expect(levelOf(["radar", "chipA"])).to.equal("platform");
	});

	it("shows the context folder and its ancestors only", () => {
		expect(visibleIn(["radar"], ["radar", "chipA", "customerB"])).to.equal(true);
		expect(visibleIn(["radar", "chipB"], ["radar", "chipA", "customerB"])).to.equal(false);
		expect(visibleIn(["camera"], [])).to.equal(false);
		expect(visibleIn([], [])).to.equal(true);
	});

	it("lets the nearest folder win a name clash", () => {
		const { visible, shadowed } = resolveHierarchy(skills, ["radar", "chipA", "customerB"]);
		expect(visible.map(s => s.id)).to.deep.equal([
			"radar/chipA/customerB/reset-counter",
			"radar/chipA/customerB/dem-events",
		]);
		expect(shadowed).to.have.length(3); // general, product and platform reset-counter
	});

	it("uses platform skills for a platform context, general only without context", () => {
		expect(resolveHierarchy(skills, ["radar", "chipB"]).visible.map(s => s.id)).to.deep.equal([
			"radar/reset-counter",
			"radar/chipB/flash-layout",
		]);
		expect(resolveHierarchy(skills, []).visible.map(s => s.id)).to.deep.equal(["/reset-counter"]);
	});

	it("lists every level for the context picker", () => {
		expect(hierarchyContexts(skills.map(s => s.hierarchy)).map(p => p.join("/"))).to.deep.equal([
			"camera",
			"radar",
			"radar/chipA",
			"radar/chipA/customerB",
			"radar/chipA/customerC",
			"radar/chipB",
		]);
	});
});
