// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Imperative binding to the dock library: applies layouts, reads the current
 * layout back, opens/focuses views and detects USER layout changes. React
 * components never touch the dockview API directly.
 *
 * Change detection compares the current layout (our format, integer-percent
 * sizes) against a baseline captured after each programmatic apply, so a
 * container resize (proportions preserved) is not reported as a modification.
 */

import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { normalizeLayout } from "../../../shared/nvm/workbench/layoutNormalize";
import { LayoutNode, LayoutTab, WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import { SINGLETON_VIEWS } from "../../../shared/nvm/workbench/viewIds";
import { fromDockview, toDockview } from "./layoutConverter";
import { viewRegistry } from "./registry";

const CHANGE_DEBOUNCE_MS = 400;

interface Disposable {
	dispose(): void;
}

export class WorkbenchController {
	private baseline: string | undefined;
	private applying = false;
	private changeTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly disposables: Disposable[] = [];

	constructor(
		private readonly api: DockviewApi,
		/** Called (debounced) when the user changed the layout. */
		private readonly onUserChange: (root: LayoutNode) => void,
	) {
		this.disposables.push(this.api.onDidLayoutChange(() => this.scheduleCheck()));
	}

	/** Show a layout. Returns false if nothing in it can be rendered. */
	public apply(layout: WorkbenchLayout): boolean {
		const normalized = normalizeLayout(layout, { isAvailable: v => viewRegistry.has(v) });
		if (!normalized) {
			return false;
		}
		this.applying = true;
		try {
			const width = this.api.width || 1000;
			const height = this.api.height || 700;
			this.api.fromJSON(
				toDockview(normalized.root, width, height, (tab, i) =>
					viewRegistry.titleFor(tab.view, tab.params, i),
				),
			);
		} finally {
			this.applying = false;
		}
		this.resetBaseline();
		return true;
	}

	/** The current layout in our format (undefined when everything is closed). */
	public current(): LayoutNode | undefined {
		return fromDockview(this.api.toJSON());
	}

	public hasPanels(): boolean {
		return this.api.panels.length > 0;
	}

	/** Open a view (or focus the existing singleton / first instance). */
	public showView(view: string, params?: Record<string, unknown>, forceNew = false): IDockviewPanel | undefined {
		const type = viewRegistry.get(view);
		if (!type) {
			return undefined;
		}
		const existing = this.api.panels.find(p => panelView(p) === view);
		if (existing && (SINGLETON_VIEWS.has(view) || !forceNew)) {
			if (params) {
				existing.api.updateParameters({ ...(existing.params ?? {}), ...params });
			}
			existing.api.setActive();
			this.scheduleCheck();
			return existing;
		}
		const index = this.api.panels.filter(p => panelView(p) === view).length + 1;
		const id = SINGLETON_VIEWS.has(view) ? view : `${view}#${Date.now().toString(36)}`;
		const reference = this.api.activePanel;
		const panel = this.api.addPanel({
			id,
			component: view,
			title: viewRegistry.titleFor(view, params, index),
			params: { ...(params ?? {}) },
			...(reference ? { position: { referencePanel: reference, direction: "within" as const } } : {}),
		});
		this.scheduleCheck();
		return panel;
	}

	/** Panels currently showing `view`. */
	public panelsOf(view: string): IDockviewPanel[] {
		return this.api.panels.filter(p => panelView(p) === view);
	}

	/** Tabs of the current layout, in document order (for AI / status). */
	public openViews(): LayoutTab[] {
		return this.api.panels.map(p => ({ view: panelView(p) ?? "", id: p.id }));
	}

	/** Re-check for user changes soon (e.g. after a panel's params changed). */
	public scheduleCheck(): void {
		if (this.applying) {
			return;
		}
		if (this.changeTimer) {
			clearTimeout(this.changeTimer);
		}
		this.changeTimer = setTimeout(() => this.checkForChange(), CHANGE_DEBOUNCE_MS);
	}

	public dispose(): void {
		if (this.changeTimer) {
			clearTimeout(this.changeTimer);
		}
		for (const d of this.disposables) {
			d.dispose();
		}
	}

	/** Capture the baseline once dockview has settled after an apply. */
	private resetBaseline(): void {
		this.baseline = undefined;
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				this.baseline = serialize(this.current());
			}),
		);
	}

	private checkForChange(): void {
		this.changeTimer = undefined;
		if (this.baseline === undefined) {
			return; // still settling after an apply
		}
		const current = this.current();
		const serialized = serialize(current);
		if (serialized === this.baseline) {
			return;
		}
		this.baseline = serialized;
		if (current) {
			this.onUserChange(current);
		}
	}
}

/** The workbench view id rendered by a dock panel. */
export const panelView = (p: IDockviewPanel): string | undefined => p.view?.contentComponent;

const serialize = (node: LayoutNode | undefined): string => JSON.stringify(node ?? null);
