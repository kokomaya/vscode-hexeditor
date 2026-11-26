// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Workbench view registry. The workbench core only knows this interface —
 * adding a view = writing a panel component + one `registerView` call
 * (Open/Closed). Nothing here is vendor-specific.
 */

import React from "react";
import { RecoilValueReadOnly } from "recoil";

/** Capabilities a view may need before it is useful. */
export type ViewRequirement = "layout";

/**
 * A second-level entry of a view in the view library, e.g. one concrete
 * custom view ("Reset", "DEM") under "Custom View". Picking it opens the view
 * with `params` (or focuses the panel already showing it).
 */
export interface ViewSubItem {
	key: string;
	title: string;
	hint?: string;
	params: Record<string, unknown>;
}

export interface WorkbenchPanelProps<P = Record<string, unknown>> {
	/** Dock panel id (stable for the panel's lifetime). */
	instanceId: string;
	/** Serializable per-instance parameters (persisted with the layout). */
	params: P;
	/** Merge a patch into the params (persisted, marks the layout modified). */
	setParams(patch: Partial<P>): void;
	/** False while the panel sits in a background tab. */
	isVisible: boolean;
}

// The registry stores views with different param types side by side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WorkbenchViewType<P = any> {
	id: string;
	title: string;
	description: string;
	icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	requires?: ViewRequirement[];
	multiInstance: boolean;
	/** Optional title for the n-th instance (multi-instance views). */
	instanceTitle?(params: P, index: number): string;
	/**
	 * Optional live list of second-level entries shown as a collapsible
	 * submenu under this view in the view library.
	 */
	subItems?: RecoilValueReadOnly<ViewSubItem[]>;
	/** Whether an open panel (its params) already shows the sub-item with `itemParams`. */
	matchesSubItem?(params: P, itemParams: Record<string, unknown>): boolean;
	component: React.ComponentType<WorkbenchPanelProps<P>>;
}

class ViewRegistry {
	private readonly views = new Map<string, WorkbenchViewType>();

	public register(view: WorkbenchViewType): void {
		this.views.set(view.id, view);
	}

	public get(id: string): WorkbenchViewType | undefined {
		return this.views.get(id);
	}

	public has(id: string): boolean {
		return this.views.has(id);
	}

	public all(): WorkbenchViewType[] {
		return [...this.views.values()];
	}

	/** Display title of a panel instance. */
	public titleFor(id: string, params: unknown, index: number): string {
		const view = this.views.get(id);
		if (!view) {
			return id;
		}
		return view.instanceTitle?.(params, index) ?? (index > 1 ? `${view.title} ${index}` : view.title);
	}
}

export const viewRegistry = new ViewRegistry();

/** Whether a view's requirements are met (e.g. NVM blocks are loaded). */
export const isViewUsable = (view: WorkbenchViewType, hasBlocks: boolean): boolean =>
	!view.requires?.includes("layout") || hasBlocks;
