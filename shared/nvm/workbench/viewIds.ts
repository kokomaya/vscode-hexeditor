// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Stable ids of the workbench views and their (serializable) parameters.
 * Shared by the host (layout validation, AI tools) and the webview (registry),
 * so both sides agree on what a layout file may reference.
 */

import { TableQuery } from "../views/tableQuery";

export const WorkbenchViewIds = {
	hex: "nvm.hex",
	inspector: "nvm.inspector",
	blocksTable: "nvm.blocksTable",
	blocksTree: "nvm.blocksTree",
	overview: "nvm.overview",
	annotations: "nvm.annotations",
	customView: "nvm.customView",
} as const;

export type WorkbenchViewId = (typeof WorkbenchViewIds)[keyof typeof WorkbenchViewIds];

/** Views that may appear at most once in a layout. */
export const SINGLETON_VIEWS: ReadonlySet<string> = new Set<string>([
	WorkbenchViewIds.hex,
	WorkbenchViewIds.inspector,
	WorkbenchViewIds.overview,
	WorkbenchViewIds.annotations,
]);

const ALL_VIEW_IDS: ReadonlySet<string> = new Set<string>(Object.values(WorkbenchViewIds));

export const isWorkbenchViewId = (id: unknown): id is WorkbenchViewId =>
	typeof id === "string" && ALL_VIEW_IDS.has(id);

/** Params of a Blocks Table panel instance (its saved filter / sort / columns). */
export type BlocksTableParams = TableQuery;

/** Params of a Custom View panel instance. */
export interface CustomViewParams {
	/** Id of the custom view to show (undefined = the first available). */
	customViewId?: string;
	/** Per-group table state (sort / visible columns), keyed by the group key. */
	groupTables?: Record<string, TableQuery>;
}

/** Params of a Blocks Tree panel instance. */
export interface BlocksTreeParams {
	/** Arrangement id (see `shared/nvm/views/blockArrangement.ts`). */
	arrangement?: string;
}
