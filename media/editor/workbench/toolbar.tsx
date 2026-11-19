// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Workbench toolbar. Deliberately minimal for newcomers: layout preset, add a
 * view, reset — plus lock / save-as / ask-AI as small icon buttons.
 */

import AddIcon from "@vscode/codicons/src/icons/add.svg";
import AskIcon from "@vscode/codicons/src/icons/comment-discussion.svg";
import DiscardIcon from "@vscode/codicons/src/icons/discard.svg";
import LockIcon from "@vscode/codicons/src/icons/lock.svg";
import SaveAsIcon from "@vscode/codicons/src/icons/save-as.svg";
import UnlockIcon from "@vscode/codicons/src/icons/unlock.svg";
import React, { useState } from "react";
import { PresetSource } from "../../../shared/nvm/workbench/presets";
import { throwOnUndefinedAccessInDev } from "../util";
import { PresetSnapshot } from "./presetSession";
import { SearchBox } from "./searchBox";
import { ViewLibrary } from "./viewLibrary";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

const RESET_ALL = "__resetAll__";

const SOURCE_LABELS: Record<PresetSource, string> = {
	builtin: "Built-in",
	scene: "Scenario",
	user: "My layouts",
};

export interface ToolbarProps {
	snapshot: PresetSnapshot;
	hasBlocks: boolean;
	openViews: ReadonlySet<string>;
	onSelectPreset(id: string): void;
	onReset(): void;
	onResetAll(): void;
	onToggleLock(): void;
	onSaveAs(): void;
	onAddView(viewId: string): void;
	onAskAi(): void;
}

export const WorkbenchToolbar: React.FC<ToolbarProps> = props => {
	const { snapshot } = props;
	const [libraryOpen, setLibraryOpen] = useState(false);
	const sources = (["builtin", "scene", "user"] as const).filter(src =>
		snapshot.presets.some(p => p.source === src),
	);

	return (
		<div className={style.toolbar}>
			<label className={style.presetLabel}>
				Layout
				<select
					className={style.presetSelect}
					value={snapshot.activeId}
					onChange={e =>
						e.target.value === RESET_ALL ? props.onResetAll() : props.onSelectPreset(e.target.value)
					}
				>
					{sources.map(src => (
						<optgroup key={src} label={SOURCE_LABELS[src]}>
							{snapshot.presets
								.filter(p => p.source === src)
								.map(p => (
									<option key={p.layout.id} value={p.layout.id}>
										{p.layout.name}
									</option>
								))}
						</optgroup>
					))}
					<optgroup label="—">
						<option value={RESET_ALL}>Reset all layouts</option>
					</optgroup>
				</select>
			</label>
			{snapshot.modified && (
				<span className={style.modified} title="This layout differs from the preset">
					● modified
				</span>
			)}
			<span className={style.toolbarAnchor}>
				<button className={style.textButton} onClick={() => setLibraryOpen(v => !v)} title="Add a view">
					<AddIcon /> View
				</button>
				{libraryOpen && (
					<ViewLibrary
						hasBlocks={props.hasBlocks}
						openViews={props.openViews}
						onPick={props.onAddView}
						onClose={() => setLibraryOpen(false)}
					/>
				)}
			</span>
			<button
				className={style.textButton}
				onClick={props.onReset}
				disabled={!snapshot.modified}
				title="Restore this preset's original layout"
			>
				<DiscardIcon /> Reset
			</button>
			<span className={style.spacer} />
			<SearchBox />
			<button className={style.iconButton} onClick={props.onAskAi} title="Ask @nvm about the current selection">
				<AskIcon />
			</button>
			<button className={style.iconButton} onClick={props.onSaveAs} title="Save layout as…">
				<SaveAsIcon />
			</button>
			<button
				className={style.iconButton}
				onClick={props.onToggleLock}
				title={snapshot.locked ? "Unlock layout" : "Lock layout (prevent drag & resize)"}
				aria-pressed={snapshot.locked}
			>
				{snapshot.locked ? <LockIcon /> : <UnlockIcon />}
			</button>
		</div>
	);
};
