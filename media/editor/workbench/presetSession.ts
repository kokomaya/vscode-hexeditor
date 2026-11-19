// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Preset bookkeeping for one open dump: which preset is active, its override
 * layer, the lock flag, and the "auto switch to the table layout once blocks
 * arrive" rule. Framework-free (no React / dockview); the host is reached only
 * through the injected {@link HostLink}, so the logic is unit-testable.
 */

import { WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import {
	builtinPresets,
	choosePresetId,
	defaultPresetId,
	effectiveLayout,
	WorkbenchInitState,
	WorkbenchPreset,
} from "../../../shared/nvm/workbench/presets";
import { WorkbenchRequest } from "../../../shared/nvm/workbench/commands";

export interface HostLink {
	stateChanged(presetId: string, override?: WorkbenchLayout | null): void;
	request(request: WorkbenchRequest): void;
}

export interface PresetSnapshot {
	presets: WorkbenchPreset[];
	activeId: string;
	modified: boolean;
	locked: boolean;
}

export class PresetSession {
	private presets: WorkbenchPreset[];
	private overrides: Record<string, WorkbenchLayout>;
	private activeId: string;
	private locked: boolean;
	/** True once the user picked a preset or changed the layout this session. */
	private userTouched = false;
	private readonly listeners = new Set<() => void>();
	private snapshot: PresetSnapshot;

	constructor(
		init: WorkbenchInitState | undefined,
		hasBlocks: boolean,
		private readonly host: HostLink,
	) {
		this.presets = init?.presets?.length ? init.presets : builtinPresets();
		this.overrides = { ...(init?.overrides ?? {}) };
		this.locked = !!init?.locked;
		this.activeId = choosePresetId({ presets: this.presets, lastPresetId: init?.lastPresetId }, hasBlocks);
		// A remembered preset counts as an explicit choice (don't auto-switch it).
		this.userTouched = !!init?.lastPresetId;
		this.snapshot = this.makeSnapshot();
	}

	public getSnapshot = (): PresetSnapshot => this.snapshot;

	public subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Layout to render for the active preset. */
	public activeLayout(): WorkbenchLayout | undefined {
		return effectiveLayout({ presets: this.presets, overrides: this.overrides }, this.activeId);
	}

	/** Original (un-overridden) layout of a preset. */
	public originalLayout(presetId: string): WorkbenchLayout | undefined {
		return this.presets.find(p => p.layout.id === presetId)?.layout;
	}

	/**
	 * Blocks just became available: if the user never chose a layout, move from
	 * the hex-only default to the table-first one. Returns true if it switched.
	 */
	public onBlocksAvailable(): boolean {
		const target = defaultPresetId(true);
		if (this.userTouched || this.activeId === target) {
			return false;
		}
		this.activeId = target;
		this.emit();
		return true;
	}

	public select(presetId: string): boolean {
		if (!this.presets.some(p => p.layout.id === presetId)) {
			return false;
		}
		this.userTouched = true;
		this.activeId = presetId;
		this.host.stateChanged(presetId);
		this.emit();
		return true;
	}

	/** The user rearranged the layout: store it as the active preset's override. */
	public userChanged(layout: WorkbenchLayout): void {
		this.userTouched = true;
		const override = { ...layout, id: this.activeId, name: this.activeName() };
		this.overrides[this.activeId] = override;
		this.host.stateChanged(this.activeId, override);
		this.emit();
	}

	/** Drop the active preset's override. */
	public reset(): void {
		delete this.overrides[this.activeId];
		this.host.stateChanged(this.activeId, null);
		this.emit();
	}

	public resetAll(): void {
		this.overrides = {};
		this.host.request({ kind: "resetAll" });
		this.emit();
	}

	public setLocked(locked: boolean): void {
		this.locked = locked;
		this.host.request({ kind: "setLocked", locked });
		this.emit();
	}

	public saveAs(current: WorkbenchLayout): void {
		this.host.request({ kind: "saveAs", layout: current });
	}

	/** Host replaced the preset list (e.g. a new user layout was saved). */
	public setPresets(presets: WorkbenchPreset[], activate?: string): void {
		this.presets = presets.length ? presets : builtinPresets();
		if (activate && this.presets.some(p => p.layout.id === activate)) {
			this.activeId = activate;
			this.host.stateChanged(activate);
		} else if (!this.presets.some(p => p.layout.id === this.activeId)) {
			this.activeId = defaultPresetId(true);
		}
		this.emit();
	}

	private activeName(): string {
		return this.originalLayout(this.activeId)?.name ?? this.activeId;
	}

	private makeSnapshot(): PresetSnapshot {
		return {
			presets: this.presets,
			activeId: this.activeId,
			modified: this.overrides[this.activeId] !== undefined,
			locked: this.locked,
		};
	}

	private emit(): void {
		this.snapshot = this.makeSnapshot();
		for (const l of [...this.listeners]) {
			l();
		}
	}
}
