/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { parseSkillListing, safeSkillPath, skillFileUrl } from "../../shared/nvm/skills/remoteSkills";
import { buildTableModel } from "../../shared/nvm/views/blocksTableModel";
import { toggleColumn } from "../../shared/nvm/views/tableQuery";
import { NvmBlockInfo } from "../../shared/protocol";
import { AnnotationSet } from "../nvm/annotations/model";
import { buildNotePrompt, DEFAULT_NOTE_INSTRUCTION, lastExchange, parseNoteReply } from "../nvm/ai/conclusionNote";
import { ownerOf } from "../nvm/report/reportAnnotations";
import { generateReport } from "../nvm/report/reportGenerator";

const blocks: NvmBlockInfo[] = [
	{ id: "a1", name: "ResetCounter", offset: 0x100, length: 16, identity: { key: "R", label: "ResetCounter" }, sequence: 1, attributes: [{ key: "status", label: "Status", value: "valid" }] },
	{ id: "a2", name: "ResetCounter", offset: 0x200, length: 16, identity: { key: "R", label: "ResetCounter" }, sequence: 3, isLatest: true },
	{ id: "b1", name: "Odometer", offset: 0x300, length: 8, identity: { key: "O", label: "Odometer" }, sequence: 2, isLatest: true },
];

const annotations: AnnotationSet = {
	version: 1,
	bookmarks: [{ id: "bm", anchor: { offset: 0x300 }, label: "odo start", createdAt: 0 }],
	tags: [{ id: "t", label: "suspicious" }],
	tagAssignments: [{ id: "ta", tagId: "t", anchor: { offset: 0x200, endOffset: 0x210 } }],
	notes: [{ id: "n", anchor: { offset: 0x204, endOffset: 0x205 }, title: "Watchdog reset", createdAt: 0, updatedAt: 0 }],
};

describe("NVM notes, report & skill install", () => {
	describe("table column toggling", () => {
		const all = buildTableModel(blocks).columns;
		const keys = all.map(c => c.key);

		it("hides a column, then shows it again (back to 'all')", () => {
			const hidden = toggleColumn(all, undefined, "__offset");
			expect(hidden).to.deep.equal(keys.filter(k => k !== "__offset"));
			expect(toggleColumn(all, hidden, "__offset")).to.equal(undefined);
		});

		it("never hides the name column", () => {
			expect(toggleColumn(all, undefined, "__name")).to.equal(undefined);
		});
	});

	describe("report", () => {
		const md = generateReport({
			fileName: "dump.mot",
			blocks,
			annotations,
			noteBodies: new Map([["n", "# Watchdog reset\n\nReset reason was WATCHDOG."]]),
			insights: { findings: [{ severity: "error", message: "CRC mismatch", offset: 0x204, source: "risk" }], questions: [], truncated: false },
			generatedAt: new Date(0),
		});

		it("follows the overview order, then annotations, then the block appendix", () => {
			const order = ["## Overview", "## Findings", "## Most recent write", "## Most rewritten", "## Annotations", "## Appendix: blocks"];
			const positions = order.map(h => md.indexOf(h));
			expect(positions.every(p => p >= 0)).to.equal(true);
			expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions);
		});

		it("places findings and annotations on their owning block", () => {
			expect(md).to.contain("CRC mismatch — ResetCounter @ 0x204");
			expect(md).to.contain("`0x204` · in **ResetCounter**");
			expect(md).to.contain("| suspicious | 0x200–0x210 | ResetCounter |");
			expect(md).to.contain("| odo start | 0x300 | Odometer |");
		});

		it("includes note bodies without repeating the title heading", () => {
			expect(md).to.contain("Reset reason was WATCHDOG.");
			expect(md.match(/Watchdog reset/g)?.length).to.equal(1);
		});

		it("prefers the latest instance when blocks overlap", () => {
			const overlapping: NvmBlockInfo[] = [
				{ id: "old", name: "Old", offset: 0, length: 32 },
				{ id: "new", name: "New", offset: 0, length: 32, isLatest: true },
			];
			expect(ownerOf(4, overlapping)?.id).to.equal("new");
		});
	});

	describe("conclusion notes", () => {
		const history = [
			{ prompt: "Why did the ECU reset?", participant: "nvmStudio.nvm" },
			{ participant: "nvmStudio.nvm", response: [{ value: { value: "ResetCounter shows a WATCHDOG reset " } }, { value: "after flashing." }] },
		];

		it("finds the last answer and its question", () => {
			expect(lastExchange(history, "nvmStudio.nvm")).to.deep.equal({
				question: "Why did the ECU reset?",
				answer: "ResetCounter shows a WATCHDOG reset after flashing.",
			});
			expect(lastExchange([], "nvmStudio.nvm")).to.equal(undefined);
		});

		it("uses the user's instruction, or the default one", () => {
			const ex = { question: "q", answer: "a" };
			expect(buildNotePrompt(ex, "only the root cause")).to.contain("Instruction: only the root cause");
			expect(buildNotePrompt(ex, "  ")).to.contain(DEFAULT_NOTE_INSTRUCTION);
		});

		it("splits the reply into a title and bullet body", () => {
			expect(parseNoteReply("# Watchdog reset after flash\n- reason WATCHDOG\n- count 7", "x")).to.deep.equal({
				title: "Watchdog reset after flash",
				body: "- reason WATCHDOG\n- count 7",
			});
			expect(parseNoteReply("- only bullets", "Fallback").title).to.equal("Fallback");
		});
	});

	describe("remote skills", () => {
		it("rejects unsafe names and paths", () => {
			expect(safeSkillPath("res/a.md")).to.equal("res/a.md");
			expect(safeSkillPath("../evil.md")).to.equal(undefined);
			expect(safeSkillPath(".hidden")).to.equal(undefined);
			const listing = parseSkillListing({
				skills: [
					{ name: "good", description: "d", files: ["SKILL.md", "fields/x.md"] },
					{ id: "雷达/chipA/reset", name: "reset", path: ["雷达", "chipA"], files: ["SKILL.md"] },
					{ name: "..", files: ["SKILL.md"] },
					{ name: "traversal", files: ["SKILL.md", "../../x"] },
					{ name: "deep", path: ["a", "b", "c", "d"], files: ["SKILL.md"] },
					{ name: "badpath", path: ["..", "x"], files: ["SKILL.md"] },
					{ id: "other/spoofed", name: "spoofed", path: [], files: ["SKILL.md"] },
					{ name: "noskill", files: ["README.md"] },
				],
				levels: [{ path: ["雷达"], title: "Radar" }],
			});
			expect(listing.skills.map(s => s.id)).to.deep.equal(["good", "雷达/chipA/reset"]);
			expect(listing.skills[1].level).to.equal("platform");
			expect(listing.levels[0]).to.deep.include({ level: "product", title: "Radar" });
		});

		it("builds encoded file URLs", () => {
			expect(skillFileUrl("http://h:1/", "radar/chip A/x", "a/b.md")).to.equal(
				"http://h:1/v1/skills/file?skill=radar%2Fchip%20A%2Fx&path=a%2Fb.md",
			);
		});
	});
});
