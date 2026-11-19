// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Scenario-layout recommendation: a scene layout (from a skill or a workspace
 * `*.nvmworkbench.json`) may declare `when.anyBlockMatches` (a block-name
 * glob). The first matching scene is suggested for a freshly opened dump.
 * Pure: decided on the blocks only, no vendor knowledge.
 */

import { selectBlocks } from "../customView";
import { NvmBlockInfo } from "../../protocol";
import { WorkbenchLayout } from "./layoutSchema";
import { WorkbenchPreset } from "./presets";

/** Whether a scene layout applies to these blocks (no condition = never auto-picked). */
export function sceneMatches(layout: WorkbenchLayout, blocks: readonly NvmBlockInfo[]): boolean {
	const glob = layout.when?.anyBlockMatches;
	if (!glob || blocks.length === 0) {
		return false;
	}
	return selectBlocks({ by: "nameGlob", value: glob }, blocks).length > 0;
}

/** The first scenario preset recommended for these blocks, if any. */
export function recommendScene(
	presets: readonly WorkbenchPreset[],
	blocks: readonly NvmBlockInfo[],
): WorkbenchPreset | undefined {
	return presets.find(p => p.source === "scene" && sceneMatches(p.layout, blocks));
}
