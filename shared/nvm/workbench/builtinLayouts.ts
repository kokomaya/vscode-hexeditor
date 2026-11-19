// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Built-in, read-only workbench presets. Generic views only — no vendor or
 * project knowledge. User changes are stored as an override layer on top of
 * these (see the host's layout store), so "Reset" simply drops the override.
 */

import { WorkbenchLayout } from "./layoutSchema";
import { WorkbenchViewIds as V } from "./viewIds";

export const BuiltinPresetIds = {
	tableFocus: "builtin.tableFocus",
	hexFocus: "builtin.hexFocus",
	structure: "builtin.structure",
	investigate: "builtin.investigate",
	overview: "builtin.overview",
} as const;

export const BUILTIN_LAYOUTS: readonly WorkbenchLayout[] = [
	{
		version: 1,
		id: BuiltinPresetIds.tableFocus,
		name: "Table focus",
		requires: ["layout"],
		root: {
			split: "horizontal",
			sizes: [60, 40],
			children: [
				{ tabs: [{ view: V.blocksTable }, { view: V.overview }] },
				{
					split: "vertical",
					sizes: [60, 40],
					children: [{ tabs: [{ view: V.hex }] }, { tabs: [{ view: V.inspector }] }],
				},
			],
		},
	},
	{
		version: 1,
		id: BuiltinPresetIds.hexFocus,
		name: "Hex focus (classic)",
		root: { tabs: [{ view: V.hex }] },
	},
	{
		version: 1,
		id: BuiltinPresetIds.structure,
		name: "Structure browser",
		requires: ["layout"],
		root: {
			split: "horizontal",
			sizes: [25, 45, 30],
			children: [
				{ tabs: [{ view: V.blocksTree }] },
				{
					split: "vertical",
					sizes: [55, 45],
					children: [{ tabs: [{ view: V.blocksTable }] }, { tabs: [{ view: V.hex }] }],
				},
				{ tabs: [{ view: V.inspector }] },
			],
		},
	},
	{
		version: 1,
		id: BuiltinPresetIds.investigate,
		name: "Investigate & annotate",
		requires: ["layout"],
		root: {
			split: "horizontal",
			sizes: [55, 45],
			children: [
				{ tabs: [{ view: V.blocksTable }, { view: V.annotations }] },
				{
					split: "vertical",
					sizes: [55, 45],
					children: [{ tabs: [{ view: V.hex }] }, { tabs: [{ view: V.inspector }] }],
				},
			],
		},
	},
	{
		version: 1,
		id: BuiltinPresetIds.overview,
		name: "Overview",
		requires: ["layout"],
		root: {
			split: "horizontal",
			sizes: [55, 45],
			children: [
				{ tabs: [{ view: V.overview }] },
				{
					split: "vertical",
					sizes: [60, 40],
					children: [{ tabs: [{ view: V.blocksTable }] }, { tabs: [{ view: V.hex }] }],
				},
			],
		},
	},
];

export function findBuiltinLayout(id: string): WorkbenchLayout | undefined {
	return BUILTIN_LAYOUTS.find(l => l.id === id);
}
