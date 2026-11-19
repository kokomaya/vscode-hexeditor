// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Small dock chrome parts: the per-group maximize/restore action and the
 * empty state shown when every panel has been closed. (The empty state is an
 * overlay rendered by the workbench, not dockview's watermark slot, whose
 * re-mount cycle froze the renderer when the last panel closed.)
 */

import type { IDockviewHeaderActionsProps } from "dockview-react";
import React, { useContext, useEffect, useState } from "react";
import { WorkbenchViewIds } from "../../../shared/nvm/workbench/viewIds";
import { EmptyState } from "../components/emptyState";
import { throwOnUndefinedAccessInDev } from "../util";
import { WorkbenchServicesContext } from "./panelHost";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

/** Maximize / restore the group (double-clicking is not discoverable enough). */
export const GroupActions: React.FC<IDockviewHeaderActionsProps> = ({ api, containerApi }) => {
	const [maximized, setMaximized] = useState(api.isMaximized());

	useEffect(() => {
		const d = containerApi.onDidMaximizedGroupChange(() => setMaximized(api.isMaximized()));
		return () => d.dispose();
	}, [api, containerApi]);

	return (
		<button
			className={style.groupAction}
			title={maximized ? "Restore" : "Maximize"}
			onClick={() => (maximized ? api.exitMaximized() : api.maximize())}
		>
			{maximized ? "❐" : "□"}
		</button>
	);
};

/** Shown when the user closed every panel. */
export const EmptyWorkbench: React.FC = () => {
	const services = useContext(WorkbenchServicesContext);
	return (
		<div className={style.emptyOverlay}>
			<EmptyState
			title="All views are closed"
			message="Add a view from the library, or restore the layout."
			actions={[
				{ label: "Restore layout", primary: true, onClick: () => services.restoreLayout() },
				{ label: "Open Blocks table", onClick: () => services.showView(WorkbenchViewIds.blocksTable) },
				{ label: "Open Hex", onClick: () => services.showView(WorkbenchViewIds.hex) },
			]}
			/>
		</div>
	);
};
