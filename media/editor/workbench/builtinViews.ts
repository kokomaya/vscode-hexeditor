// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Composition root: registers the built-in workbench views. This is the only
 * file that knows the concrete panel components; the workbench core works off
 * the registry alone.
 */

import BookmarkIcon from "@vscode/codicons/src/icons/bookmark.svg";
import DashboardIcon from "@vscode/codicons/src/icons/dashboard.svg";
import FileBinaryIcon from "@vscode/codicons/src/icons/file-binary.svg";
import InspectIcon from "@vscode/codicons/src/icons/inspect.svg";
import ListTreeIcon from "@vscode/codicons/src/icons/list-tree.svg";
import PreviewIcon from "@vscode/codicons/src/icons/preview.svg";
import TableIcon from "@vscode/codicons/src/icons/table.svg";
import { WorkbenchViewIds as V } from "../../../shared/nvm/workbench/viewIds";
import { HexPanel } from "../hexPanel";
import { AnnotationsPanel } from "./panels/annotations/annotationsPanel";
import { BlocksTablePanel } from "./panels/blocksTable/blocksTablePanel";
import { BlocksTreePanel } from "./panels/blocksTree/blocksTreePanel";
import { CustomViewPanel } from "./panels/customView/customViewPanel";
import { InspectorPanel } from "./panels/inspectorPanel";
import { OverviewPanel } from "./panels/overview/overviewPanel";
import { viewRegistry } from "./registry";

let registered = false;

export function registerBuiltinViews(): void {
	if (registered) {
		return;
	}
	registered = true;

	viewRegistry.register({
		id: V.blocksTable,
		title: "Blocks",
		description: "Sortable, searchable table of all NVM blocks",
		icon: TableIcon,
		requires: ["layout"],
		multiInstance: true,
		component: BlocksTablePanel,
	});
	viewRegistry.register({
		id: V.hex,
		title: "Hex",
		description: "Raw bytes with NVM field coloring",
		icon: FileBinaryIcon,
		multiInstance: false,
		component: HexPanel,
	});
	viewRegistry.register({
		id: V.inspector,
		title: "Inspector",
		description: "Decoded value tree and primitive types of the selection",
		icon: InspectIcon,
		multiInstance: false,
		component: InspectorPanel,
	});
	viewRegistry.register({
		id: V.overview,
		title: "Overview",
		description: "Dump summary, activity and suggested questions",
		icon: DashboardIcon,
		requires: ["layout"],
		multiInstance: false,
		component: OverviewPanel,
	});
	viewRegistry.register({
		id: V.blocksTree,
		title: "Tree",
		description: "Blocks arranged by address, sector, write order or identity",
		icon: ListTreeIcon,
		requires: ["layout"],
		multiInstance: true,
		component: BlocksTreePanel,
	});
	viewRegistry.register({
		id: V.customView,
		title: "Custom View",
		description: 'Your comparison views (e.g. "Reset", "DEM") across matching blocks',
		icon: PreviewIcon,
		requires: ["layout"],
		multiInstance: true,
		component: CustomViewPanel,
	});
	viewRegistry.register({
		id: V.annotations,
		title: "Annotations",
		description: "Bookmarks, notes and tagged ranges of this dump",
		icon: BookmarkIcon,
		multiInstance: false,
		component: AnnotationsPanel,
	});
}
