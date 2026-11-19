// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Payload types exchanged between the host and the workbench webview. The
 * message envelopes live in `shared/protocol.ts` (the contract); these are the
 * workbench-specific bodies, kept here so the protocol file stays small.
 */

import { TableQuery } from "../views/tableQuery";
import { WorkbenchLayout } from "./layoutSchema";
import { WorkbenchPreset } from "./presets";

/** Host → webview: drive the workbench (used by commands and the AI). */
export type WorkbenchCommand =
	/** Open (or focus) a view; singleton views are focused if already open. */
	| { kind: "showView"; view: string; params?: Record<string, unknown> }
	/** Apply a filter/sort to the (first) Blocks Table, opening one if needed. */
	| { kind: "filterTable"; query: TableQuery }
	/** Show an ad-hoc layout (validated + normalized by the webview). */
	| { kind: "applyLayout"; layout: WorkbenchLayout }
	/** Switch to a preset. */
	| { kind: "selectPreset"; presetId: string }
	/** Drop the user override of the active preset. */
	| { kind: "resetLayout" }
	/** Replace the preset list (e.g. after "Save layout as…"). */
	| { kind: "setPresets"; presets: WorkbenchPreset[]; activate?: string };

/** Whitelisted host actions a panel may trigger (never arbitrary commands). */
export type WorkbenchAction = "selectLayoutProfile" | "reloadLayout" | "openReport";

/** Webview → host: workbench requests that need host UI or persistence. */
export type WorkbenchRequest =
	| { kind: "saveAs"; layout: WorkbenchLayout }
	| { kind: "setLocked"; locked: boolean }
	| { kind: "resetAll" }
	| { kind: "runAction"; action: WorkbenchAction };

/** The single "current focus" of a dump, reported to the host (chat, status bar). */
export interface NvmFocus {
	offset: number;
	length?: number;
	blockId?: string;
	blockName?: string;
	fieldName?: string;
}
