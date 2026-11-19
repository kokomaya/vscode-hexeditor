// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Preset bookkeeping shared by host and webview: the persisted workbench state
 * shape, how the effective layout of a preset is resolved (override layer over
 * the original), and which preset a freshly opened dump starts with.
 */

import { BuiltinPresetIds, BUILTIN_LAYOUTS } from "./builtinLayouts";
import { WorkbenchLayout } from "./layoutSchema";

/** Where a preset comes from (shown in the picker). */
export type PresetSource = "builtin" | "scene" | "user";

export interface WorkbenchPreset {
	layout: WorkbenchLayout;
	source: PresetSource;
}

/** Workbench state the host persists and hands to the webview on open. */
export interface WorkbenchInitState {
	/** All selectable presets (built-in first). */
	presets: WorkbenchPreset[];
	/** User modifications per preset id (the override layer). */
	overrides: Record<string, WorkbenchLayout>;
	/** Preset this dump used last time, if any. */
	lastPresetId?: string;
	/** Whether drag/drop is locked. */
	locked?: boolean;
}

export const builtinPresets = (): WorkbenchPreset[] =>
	BUILTIN_LAYOUTS.map(layout => ({ layout, source: "builtin" as const }));

/** The layout to show for a preset: the user's override, else the original. */
export function effectiveLayout(
	state: Pick<WorkbenchInitState, "presets" | "overrides">,
	presetId: string,
): WorkbenchLayout | undefined {
	return (
		state.overrides[presetId] ?? state.presets.find(p => p.layout.id === presetId)?.layout
	);
}

/**
 * Choose the preset for a dump: the one it used last time (if it still
 * exists), else the table-first layout when NVM blocks are available, else the
 * classic hex layout.
 */
export function choosePresetId(
	state: Pick<WorkbenchInitState, "presets" | "lastPresetId">,
	hasBlocks: boolean,
): string {
	const last = state.lastPresetId;
	if (last && state.presets.some(p => p.layout.id === last)) {
		return last;
	}
	return defaultPresetId(hasBlocks);
}

export const defaultPresetId = (hasBlocks: boolean): string =>
	hasBlocks ? BuiltinPresetIds.tableFocus : BuiltinPresetIds.hexFocus;
