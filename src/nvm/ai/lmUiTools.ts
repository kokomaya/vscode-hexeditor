// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * LM tools that let the assistant drive the UI (reveal, open views, filter
 * the Blocks table, apply layouts). Thin adapters over {@link UiCapabilities};
 * view-only, so no confirmation is required.
 */

import * as vscode from "vscode";
import { guarded, LmApi } from "./lmToolKit";
import { NvmCapabilities } from "./nvmCapabilities";

const parseOffset = (v: unknown): number | undefined => {
	if (typeof v === "number") {
		return v;
	}
	if (typeof v === "string" && v.trim()) {
		const n = Number(v.trim());
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
};

export function registerUiTools(lm: LmApi, caps: NvmCapabilities): vscode.Disposable[] {
	const ui = caps.ui;
	return [
		lm.registerTool<{ block?: string; offset?: number | string }>("nvm_reveal", {
			prepareInvocation: o => ({
				invocationMessage: `Showing ${o.input?.block ?? o.input?.offset ?? "location"} in the editor`,
			}),
			invoke: async o =>
				guarded(() => ui.reveal({ block: o.input?.block, offset: parseOffset(o.input?.offset) })),
		}),
		lm.registerTool<{ view: string }>("nvm_showView", {
			invoke: async o => guarded(() => ui.showView(o.input?.view ?? "")),
		}),
		lm.registerTool<{
			search?: string;
			sortBy?: string;
			descending?: boolean;
			columns?: string[];
			latestOnly?: boolean;
		}>("nvm_filterTable", {
			invoke: async o =>
				guarded(() => {
					const i = o.input ?? {};
					return ui.filterTable({
						search: i.search,
						sort: i.sortBy ? { key: i.sortBy, dir: i.descending ? -1 : 1 } : undefined,
						columns: i.columns,
						latestOnly: i.latestOnly,
					}).text;
				}),
		}),
		lm.registerTool<{ preset?: string; layout?: unknown }>("nvm_applyLayout", {
			invoke: async o => guarded(() => ui.applyLayout(o.input ?? {})),
		}),
	];
}
