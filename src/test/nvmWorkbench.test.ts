/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { expect } from "chai";
import { flattenTree, groupPathTo } from "../../media/editor/workbench/panels/blocksTree/flattenTree";
import { fromDockview, toDockview } from "../../media/editor/workbench/layoutConverter";
import { HostLink, PresetSession } from "../../media/editor/workbench/presetSession";
import { arrangementById } from "../../shared/nvm/views/blockArrangement";
import { buildTableModel } from "../../shared/nvm/views/blocksTableModel";
import { summarizeBlocks } from "../../shared/nvm/views/dumpSummary";
import { applyTableQuery, cycleSort, sanitizeTableQuery } from "../../shared/nvm/views/tableQuery";
import { BuiltinPresetIds, BUILTIN_LAYOUTS } from "../../shared/nvm/workbench/builtinLayouts";
import { WorkbenchRequest } from "../../shared/nvm/workbench/commands";
import { normalizeLayout } from "../../shared/nvm/workbench/layoutNormalize";
import { isSplit, LayoutNode, validateLayout, WorkbenchLayout } from "../../shared/nvm/workbench/layoutSchema";
import { builtinPresets, choosePresetId } from "../../shared/nvm/workbench/presets";
import { WorkbenchViewIds as V } from "../../shared/nvm/workbench/viewIds";
import { NvmBlockInfo } from "../../shared/protocol";

/** Vendor-neutral synthetic blocks: two logical blocks, A with 3 versions. */
const blocks: NvmBlockInfo[] = [
	{ id: "a1", name: "BlockA", offset: 0x100, length: 16, sequence: 1, identity: { key: "A", label: "BlockA" }, group: { key: "s0", label: "Sector 0", order: 0 }, attributes: [{ key: "tag", label: "Tag", value: 7 }] },
	{ id: "a2", name: "BlockA", offset: 0x200, length: 16, sequence: 3, identity: { key: "A", label: "BlockA" }, group: { key: "s1", label: "Sector 1", order: 1 }, attributes: [{ key: "tag", label: "Tag", value: 7 }] },
	{ id: "b1", name: "BlockB", offset: 0x180, length: 8, sequence: 2, identity: { key: "B", label: "BlockB" }, group: { key: "s0", label: "Sector 0", order: 0 }, isLatest: true, attributes: [{ key: "tag", label: "Tag", value: 9 }, { key: "crc", label: "CRC", value: "ok" }] },
	{ id: "a3", name: "BlockA", offset: 0x300, length: 16, sequence: 5, identity: { key: "A", label: "BlockA" }, group: { key: "s1", label: "Sector 1", order: 1 }, isLatest: true, attributes: [{ key: "tag", label: "Tag", value: 7 }] },
];

const allAvailable = { isAvailable: () => true };

/** Strip generated instance ids so layouts compare structurally. */
const stripIds = (node: LayoutNode): LayoutNode =>
	isSplit(node)
		? { ...node, children: node.children.map(stripIds) }
		: { ...node, tabs: node.tabs.map(({ id: _id, ...t }) => t) };

describe("NVM workbench", () => {
	describe("layout schema", () => {
		it("accepts a valid layout and fills defaults", () => {
			const r = validateLayout({ root: { tabs: [{ view: V.hex }] } });
			expect(r.ok).to.equal(true);
			if (r.ok) {
				expect(r.layout.version).to.equal(1);
				expect(r.layout.id).to.equal("custom");
			}
		});

		it("rejects bad input with a path in the message", () => {
			expect(validateLayout(null).ok).to.equal(false);
			const bad = validateLayout({ root: { split: "diagonal", children: [{ tabs: [{ view: V.hex }] }] } });
			expect(bad.ok).to.equal(false);
			if (!bad.ok) {
				expect(bad.error).to.contain("root.split");
			}
			const sizes = validateLayout({
				root: { split: "horizontal", sizes: [1], children: [{ tabs: [{ view: V.hex }] }, { tabs: [{ view: V.inspector }] }] },
			});
			expect(sizes.ok).to.equal(false);
		});
	});

	describe("layout normalization", () => {
		const layout = (root: LayoutNode): WorkbenchLayout => ({ version: 1, id: "t", name: "t", root });

		it("drops unavailable views and duplicate singletons, collapses single children", () => {
			const n = normalizeLayout(
				layout({
					split: "horizontal",
					children: [
						{ tabs: [{ view: V.hex }, { view: "unknown.view" }] },
						{ tabs: [{ view: V.hex }] },
					],
				}),
				{ isAvailable: v => v !== "unknown.view" },
			);
			expect(n?.root).to.deep.equal({ tabs: [{ view: V.hex }] });
		});

		it("flattens a same-direction nested split and scales its sizes", () => {
			const n = normalizeLayout(
				layout({
					split: "horizontal",
					sizes: [50, 50],
					children: [
						{ tabs: [{ view: V.blocksTable }] },
						{ split: "horizontal", sizes: [50, 50], children: [{ tabs: [{ view: V.hex }] }, { tabs: [{ view: V.inspector }] }] },
					],
				}),
				allAvailable,
			);
			expect(n && isSplit(n.root) && n.root.children.length).to.equal(3);
			expect(n && isSplit(n.root) && n.root.sizes).to.deep.equal([50, 25, 25]);
		});

		it("returns undefined when nothing can be shown", () => {
			expect(normalizeLayout(layout({ tabs: [{ view: "x" }] }), { isAvailable: () => false })).to.equal(undefined);
		});
	});

	describe("dock conversion", () => {
		it("round-trips every built-in preset", () => {
			for (const preset of BUILTIN_LAYOUTS) {
				const normalized = normalizeLayout(preset, allAvailable)!;
				const json = toDockview(normalized.root, 1200, 800, t => t.view);
				const back = fromDockview(json);
				expect(stripIds(back!), preset.id).to.deep.equal(stripIds(normalized.root));
			}
		});

		it("uses the view id as panel id for singletons and unique ids otherwise", () => {
			const json = toDockview({ tabs: [{ view: V.hex }, { view: V.blocksTable }, { view: V.blocksTable }] }, 800, 600, t => t.view);
			expect(Object.keys(json.panels)).to.deep.equal([V.hex, `${V.blocksTable}#1`, `${V.blocksTable}#2`]);
		});
	});

	describe("table model + query", () => {
		const model = buildTableModel(blocks);

		it("discovers attribute columns after the base columns, rows by offset", () => {
			expect(model.columns.map(c => c.key)).to.deep.equal(["__name", "__offset", "__length", "tag", "crc"]);
			expect(model.rows.map(r => r.blockId)).to.deep.equal(["a1", "b1", "a2", "a3"]);
		});

		it("filters, keeps latest-only and sorts numerically", () => {
			expect(applyTableQuery(model, { search: "blockb" }).rows.map(r => r.blockId)).to.deep.equal(["b1"]);
			expect(applyTableQuery(model, { latestOnly: true }).rows.map(r => r.blockId)).to.deep.equal(["b1", "a3"]);
			const sorted = applyTableQuery(model, { sort: { key: "__offset", dir: -1 } }).rows.map(r => r.blockId);
			expect(sorted).to.deep.equal(["a3", "a2", "b1", "a1"]);
		});

		it("always keeps the name column when projecting columns", () => {
			expect(applyTableQuery(model, { columns: ["tag"] }).columns.map(c => c.key)).to.deep.equal(["__name", "tag"]);
		});

		it("cycles sort asc → desc → none and sanitizes untrusted queries", () => {
			const asc = cycleSort(undefined, "tag");
			const desc = cycleSort(asc, "tag");
			expect(asc).to.deep.equal({ key: "tag", dir: 1 });
			expect(desc).to.deep.equal({ key: "tag", dir: -1 });
			expect(cycleSort(desc, "tag")).to.equal(undefined);
			expect(sanitizeTableQuery({ search: 5, sort: { key: "tag", dir: "desc" }, columns: ["a", 1], latestOnly: "yes" })).to.deep.equal({
				sort: { key: "tag", dir: -1 },
				columns: ["a"],
			});
		});
	});

	describe("preset session", () => {
		const fakeHost = () => {
			const calls: { presetId: string; override?: WorkbenchLayout | null }[] = [];
			const requests: WorkbenchRequest[] = [];
			const host: HostLink = {
				stateChanged: (presetId, override) => calls.push({ presetId, override }),
				request: r => requests.push(r),
			};
			return { host, calls, requests };
		};

		it("starts hex-only without blocks and switches to the table layout once they arrive", () => {
			const { host } = fakeHost();
			const session = new PresetSession(undefined, false, host);
			expect(session.getSnapshot().activeId).to.equal(BuiltinPresetIds.hexFocus);
			expect(session.onBlocksAvailable()).to.equal(true);
			expect(session.getSnapshot().activeId).to.equal(BuiltinPresetIds.tableFocus);
		});

		it("never auto-switches a preset the user chose", () => {
			const { host } = fakeHost();
			const session = new PresetSession(
				{ presets: builtinPresets(), overrides: {}, lastPresetId: BuiltinPresetIds.hexFocus },
				false,
				host,
			);
			expect(session.onBlocksAvailable()).to.equal(false);
			expect(session.getSnapshot().activeId).to.equal(BuiltinPresetIds.hexFocus);
		});

		it("stores user changes as an override and drops it on reset", () => {
			const { host, calls } = fakeHost();
			const session = new PresetSession(undefined, true, host);
			const changed: WorkbenchLayout = { version: 1, id: "", name: "", root: { tabs: [{ view: V.hex }] } };
			session.userChanged(changed);
			expect(session.getSnapshot().modified).to.equal(true);
			expect(session.activeLayout()?.root).to.deep.equal(changed.root);
			session.reset();
			expect(session.getSnapshot().modified).to.equal(false);
			expect(calls.map(c => c.override === null ? "reset" : c.override ? "override" : "select")).to.deep.equal(["override", "reset"]);
			expect(session.activeLayout()?.id).to.equal(BuiltinPresetIds.tableFocus);
		});

		it("prefers a matching scenario layout when blocks arrive", () => {
			const { host } = fakeHost();
			const scene: WorkbenchLayout = {
				version: 1, id: "scene.a", name: "A", when: { anyBlockMatches: "BlockA" }, root: { tabs: [{ view: V.hex }] },
			};
			const other: WorkbenchLayout = { ...scene, id: "scene.z", when: { anyBlockMatches: "Nope*" } };
			const presets = [...builtinPresets(), { layout: other, source: "scene" as const }, { layout: scene, source: "scene" as const }];
			const session = new PresetSession({ presets, overrides: {} }, false, host);
			expect(session.onBlocksAvailable(blocks)).to.equal(true);
			expect(session.getSnapshot().activeId).to.equal("scene.a");
		});

		it("falls back to the default when the remembered preset no longer exists", () => {
			expect(choosePresetId({ presets: builtinPresets(), lastPresetId: "user.gone" }, true)).to.equal(BuiltinPresetIds.tableFocus);
		});
	});

	describe("views", () => {
		it("summarizes a dump from generic metadata only", () => {
			const s = summarizeBlocks(blocks);
			expect(s.totalBlocks).to.equal(4);
			expect(s.identities).to.equal(2);
			expect(s.latestBlocks).to.equal(2);
			expect(s.newest?.id).to.equal("a3");
			expect(s.mostRewritten).to.have.length(1);
			expect(s.mostRewritten[0].versions).to.equal(3);
			expect(s.groups.map(g => [g.label, g.count])).to.deep.equal([["Sector 0", 2], ["Sector 1", 2]]);
		});

		it("flattens a grouped tree and finds the path to a block", () => {
			const nodes = arrangementById("sector").arrange(blocks);
			expect(flattenTree(nodes, new Set()).every(r => r.kind === "group")).to.equal(true);
			const path = groupPathTo(nodes, "a3")!;
			expect(path).to.have.length(1);
			const rows = flattenTree(nodes, new Set(path));
			expect(rows.some(r => r.kind === "block" && r.block.id === "a3")).to.equal(true);
		});
	});
});
