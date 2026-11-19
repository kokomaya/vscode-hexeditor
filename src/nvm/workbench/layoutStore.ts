// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Persistence for the workbench: per-preset user overrides, the preset each
 * dump used last, saved user layouts (workspace or personal) and the lock
 * flag. Storage only — no UI, no messaging.
 */

import * as vscode from "vscode";
import { validateLayout, WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import { builtinPresets, WorkbenchInitState, WorkbenchPreset } from "../../../shared/nvm/workbench/presets";

const OVERRIDES_KEY = "nvmstudio.workbench.overrides";
const LAST_PRESET_KEY = "nvmstudio.workbench.lastPreset";
const USER_LAYOUTS_KEY = "nvmstudio.workbench.userLayouts";
const LOCKED_KEY = "nvmstudio.workbench.locked";

export type LayoutScope = "workspace" | "personal";

export class WorkbenchLayoutStore {
	constructor(private readonly context: vscode.ExtensionContext) {}

	/** Everything the webview needs to restore the workbench for `uri`. */
	public initState(uri: vscode.Uri): WorkbenchInitState {
		return {
			presets: this.presets(),
			overrides: this.overrides(),
			lastPresetId: this.lastPresets()[uri.toString()],
			locked: this.context.globalState.get<boolean>(LOCKED_KEY, false),
		};
	}

	/** Built-in presets followed by the user's saved layouts. */
	public presets(): WorkbenchPreset[] {
		const user = [...this.userLayouts("workspace"), ...this.userLayouts("personal")].map(layout => ({
			layout,
			source: "user" as const,
		}));
		return [...builtinPresets(), ...user];
	}

	public async setLastPreset(uri: vscode.Uri, presetId: string): Promise<void> {
		const map = { ...this.lastPresets(), [uri.toString()]: presetId };
		await this.context.workspaceState.update(LAST_PRESET_KEY, map);
	}

	/** Save (layout) or drop (null) the override of a preset. */
	public async setOverride(presetId: string, layout: WorkbenchLayout | null): Promise<void> {
		const map = { ...this.overrides() };
		if (layout) {
			const checked = validateLayout(layout);
			if (!checked.ok) {
				return;
			}
			map[presetId] = { ...checked.layout, id: presetId };
		} else {
			delete map[presetId];
		}
		await this.context.workspaceState.update(OVERRIDES_KEY, map);
	}

	public async clearOverrides(): Promise<void> {
		await this.context.workspaceState.update(OVERRIDES_KEY, {});
	}

	public async setLocked(locked: boolean): Promise<void> {
		await this.context.globalState.update(LOCKED_KEY, locked);
	}

	/** Store a new user layout; returns its id. */
	public async addUserLayout(layout: WorkbenchLayout, name: string, scope: LayoutScope): Promise<string> {
		const id = `user.${Date.now().toString(36)}`;
		const list = [...this.userLayouts(scope), { ...layout, id, name }];
		await this.memento(scope).update(USER_LAYOUTS_KEY, list);
		return id;
	}

	private overrides(): Record<string, WorkbenchLayout> {
		return this.context.workspaceState.get<Record<string, WorkbenchLayout>>(OVERRIDES_KEY, {});
	}

	private lastPresets(): Record<string, string> {
		return this.context.workspaceState.get<Record<string, string>>(LAST_PRESET_KEY, {});
	}

	private userLayouts(scope: LayoutScope): WorkbenchLayout[] {
		const raw = this.memento(scope).get<unknown[]>(USER_LAYOUTS_KEY, []);
		return raw
			.map(validateLayout)
			.filter((r): r is { ok: true; layout: WorkbenchLayout } => r.ok)
			.map(r => r.layout);
	}

	private memento(scope: LayoutScope): vscode.Memento {
		return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
	}
}
