// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Adapter from a registry {@link WorkbenchViewType} to a dock panel component.
 * Gives every view the same contract (params / setParams / visibility), claims
 * the keyboard scope when the user interacts with the panel, scopes webview
 * context menus via `data-vscode-context`, and isolates crashes per panel.
 */

import type { IDockviewPanelProps } from "dockview-react";
import React, { Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSetRecoilState } from "recoil";
import { activePanelAtom } from "../panelScope";
import { VsProgressIndicator } from "../vscodeUi";
import { WorkbenchViewType } from "./registry";
import { throwOnUndefinedAccessInDev } from "../util";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

/** Services the workbench offers to its panels and dock chrome. */
export interface WorkbenchServices {
	/** A panel's params changed (persist the layout). */
	notifyParamsChanged(): void;
	/** Re-apply the active preset's layout. */
	restoreLayout(): void;
	/** Open or focus a view. */
	showView(viewId: string): void;
}

export const WorkbenchServicesContext = React.createContext<WorkbenchServices>({
	notifyParamsChanged: () => undefined,
	restoreLayout: () => undefined,
	showView: () => undefined,
});

class PanelErrorBoundary extends React.Component<
	{ title: string; children?: React.ReactNode },
	{ error?: Error }
> {
	public state: { error?: Error } = {};

	public static getDerivedStateFromError(error: Error) {
		return { error };
	}

	public render() {
		if (this.state.error) {
			return (
				<div className={style.panelError}>
					<strong>{this.props.title}</strong> failed to render: {this.state.error.message}
				</div>
			);
		}
		return this.props.children;
	}
}

export function createDockComponent(view: WorkbenchViewType): React.FC<IDockviewPanelProps> {
	const Content = view.component;

	const DockPanel: React.FC<IDockviewPanelProps> = ({ api, params }) => {
		const services = useContext(WorkbenchServicesContext);
		const setActivePanel = useSetRecoilState(activePanelAtom);
		const [isVisible, setVisible] = useState(api.isVisible);
		const paramsRef = useRef<Record<string, unknown>>(params ?? {});
		paramsRef.current = params ?? {};

		useEffect(() => {
			const d = api.onDidVisibilityChange(e => setVisible(e.isVisible));
			return () => d.dispose();
		}, [api]);

		const setParams = useCallback(
			(patch: Record<string, unknown>) => {
				const next = { ...paramsRef.current, ...patch };
				paramsRef.current = next;
				api.updateParameters(next);
				services.notifyParamsChanged();
			},
			[api, services],
		);

		const claimKeyboard = useCallback(() => setActivePanel(view.id), []);

		return (
			<div
				className={style.panelRoot}
				data-vscode-context={JSON.stringify({ webviewSection: view.id })}
				onPointerDownCapture={claimKeyboard}
				onFocusCapture={claimKeyboard}
			>
				<PanelErrorBoundary title={view.title}>
					<Suspense fallback={<VsProgressIndicator />}>
						<Content
							instanceId={api.id}
							params={paramsRef.current}
							setParams={setParams}
							isVisible={isVisible}
						/>
					</Suspense>
				</PanelErrorBoundary>
			</div>
		);
	};
	DockPanel.displayName = `DockPanel(${view.id})`;
	return DockPanel;
}
