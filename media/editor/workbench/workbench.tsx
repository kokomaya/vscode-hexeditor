// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The NVM workbench: a dock container inside the editor webview whose panels
 * (table, hex, inspector, …) come from the view registry. This component only
 * wires things together — layout logic lives in the controller, preset logic
 * in the session, command execution in the command handler.
 */

import { DockviewReact, DockviewReadyEvent, themeVisualStudio } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { BuiltinPresetIds, findBuiltinLayout } from "../../../shared/nvm/workbench/builtinLayouts";
import { WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import * as select from "../state";
import { throwOnUndefinedAccessInDev } from "../util";
import { registerBuiltinViews } from "./builtinViews";
import { onWorkbenchCommand } from "./commandBus";
import { handleWorkbenchCommand } from "./commandHandler";
import { EmptyWorkbench, GroupActions } from "./dockParts";
import { askAi, presetHostLink } from "./hostLink";
import { createDockComponent, WorkbenchServices, WorkbenchServicesContext } from "./panelHost";
import { PresetSession, PresetSnapshot } from "./presetSession";
import { viewRegistry } from "./registry";
import { WorkbenchToolbar } from "./toolbar";
import { panelView, WorkbenchController } from "./workbenchController";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

registerBuiltinViews();

/** Subscribe a component to the preset session's snapshot. */
const useSessionSnapshot = (session: PresetSession): PresetSnapshot => {
	const [snapshot, setSnapshot] = useState(session.getSnapshot());
	useEffect(() => session.subscribe(() => setSnapshot(session.getSnapshot())), [session]);
	return snapshot;
};

export const Workbench: React.FC = () => {
	const init = useRecoilValue(select.workbenchInitState);
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	const selectedBlock = useRecoilValue(select.selectedNvmBlockAtom);
	const hasBlocks = blocks.length > 0;

	const session = useMemo(() => new PresetSession(init, hasBlocks, presetHostLink), []);
	const snapshot = useSessionSnapshot(session);
	const controllerRef = useRef<WorkbenchController>();
	const [openViews, setOpenViews] = useState<ReadonlySet<string>>(new Set());
	const [ready, setReady] = useState(false);

	const components = useMemo(
		() => Object.fromEntries(viewRegistry.all().map(v => [v.id, createDockComponent(v)])),
		[],
	);

	/** Render the active preset; fall back to the hex-only layout if it can't be shown. */
	const applyActive = useCallback(() => {
		const controller = controllerRef.current;
		if (!controller) {
			return;
		}
		const layout = session.activeLayout();
		if (!layout || !controller.apply(layout)) {
			controller.apply(findBuiltinLayout(BuiltinPresetIds.hexFocus)!);
		}
	}, [session]);

	const services = useMemo<WorkbenchServices>(
		() => ({
			notifyParamsChanged: () => controllerRef.current?.scheduleCheck(),
			restoreLayout: applyActive,
			showView: viewId => controllerRef.current?.showView(viewId),
		}),
		[applyActive],
	);

	const onReady = useCallback(
		(event: DockviewReadyEvent) => {
			const controller = new WorkbenchController(event.api, root => {
				const layout: WorkbenchLayout = { version: 1, id: session.getSnapshot().activeId, name: "", root };
				session.userChanged(layout);
			});
			controllerRef.current = controller;
			const refreshOpenViews = () =>
				setOpenViews(new Set(event.api.panels.map(p => panelView(p) ?? "")));
			event.api.onDidAddPanel(refreshOpenViews);
			event.api.onDidRemovePanel(refreshOpenViews);
			applyActive();
			refreshOpenViews();
			setReady(true);
		},
		[session, applyActive],
	);

	// Blocks arrived after open: switch to the table-first layout if untouched.
	useEffect(() => {
		if (hasBlocks && session.onBlocksAvailable(blocks)) {
			applyActive();
		}
	}, [hasBlocks]);

	// Host / AI commands.
	useEffect(
		() =>
			onWorkbenchCommand(command => {
				const controller = controllerRef.current;
				if (controller) {
					handleWorkbenchCommand(command, { controller, session, applyActive });
				}
			}),
		[session, applyActive],
	);

	useEffect(() => () => controllerRef.current?.dispose(), []);

	const onSaveAs = () => {
		const root = controllerRef.current?.current();
		if (root) {
			session.saveAs({ version: 1, id: "", name: "", root });
		}
	};

	const onAskAi = () =>
		askAi(
			selectedBlock
				? `Explain the block "${selectedBlock.name ?? selectedBlock.id}" at offset 0x${selectedBlock.offset.toString(16)}: what does it contain and does anything look abnormal?`
				: "Give me an overview of this dump. What should I look at first?",
		);

	return (
		<WorkbenchServicesContext.Provider value={services}>
			<div className={style.workbench}>
				<WorkbenchToolbar
					snapshot={snapshot}
					hasBlocks={hasBlocks}
					openViews={openViews}
					onSelectPreset={id => session.select(id) && applyActive()}
					onReset={() => {
						session.reset();
						applyActive();
					}}
					onResetAll={() => {
						session.resetAll();
						applyActive();
					}}
					onToggleLock={() => session.setLocked(!snapshot.locked)}
					onSaveAs={onSaveAs}
					onAddView={viewId => controllerRef.current?.showView(viewId, undefined, true)}
					onAskAi={onAskAi}
				/>
				<div className={style.dockHost}>
					<DockviewReact
						components={components}
						onReady={onReady}
						theme={themeVisualStudio}
						rightHeaderActionsComponent={GroupActions}
						disableFloatingGroups={true}
						locked={snapshot.locked}
						disableDnd={snapshot.locked}
					/>
					{ready && openViews.size === 0 && <EmptyWorkbench />}
				</div>
			</div>
		</WorkbenchServicesContext.Provider>
	);
};
