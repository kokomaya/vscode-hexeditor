// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * View library popover: every registered view, with unusable ones greyed out
 * and the reason shown. Picking a view opens it (or focuses the open
 * singleton). Views with sub-items (e.g. "Custom View" → "Reset", "DEM")
 * render as a collapsible second level.
 */

import ChevronDownIcon from "@vscode/codicons/src/icons/chevron-down.svg";
import ChevronRightIcon from "@vscode/codicons/src/icons/chevron-right.svg";
import React, { useEffect, useRef, useState } from "react";
import { RecoilValueReadOnly, useRecoilValue } from "recoil";
import { SINGLETON_VIEWS } from "../../../shared/nvm/workbench/viewIds";
import { clsx, throwOnUndefinedAccessInDev } from "../util";
import { isViewUsable, viewRegistry, ViewSubItem, WorkbenchViewType } from "./registry";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

export interface ViewLibraryProps {
	hasBlocks: boolean;
	openViews: ReadonlySet<string>;
	onPick(viewId: string, params?: Record<string, unknown>): void;
	onClose(): void;
}

export const ViewLibrary: React.FC<ViewLibraryProps> = props => {
	const { onClose } = props;
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [onClose]);

	return (
		<div ref={ref} className={style.viewLibrary} role="menu">
			{viewRegistry.all().map(view =>
				view.subItems ? (
					<ViewWithSubItems key={view.id} view={view} subItems={view.subItems} {...props} />
				) : (
					<ViewItem key={view.id} view={view} {...props} />
				),
			)}
		</div>
	);
};

const hintFor = (view: WorkbenchViewType, usable: boolean, isOpen: boolean): string =>
	!usable
		? "Needs a recognized NVM layout"
		: isOpen && SINGLETON_VIEWS.has(view.id)
			? "Open — click to focus"
			: view.description;

const ViewItem: React.FC<ViewLibraryProps & { view: WorkbenchViewType }> = ({
	view,
	hasBlocks,
	openViews,
	onPick,
	onClose,
}) => {
	const usable = isViewUsable(view, hasBlocks);
	const Icon = view.icon;
	return (
		<button
			role="menuitem"
			className={clsx(style.viewLibraryItem, !usable && style.disabled)}
			disabled={!usable}
			onClick={() => {
				onPick(view.id);
				onClose();
			}}
		>
			<Icon className={style.viewLibraryIcon} />
			<span className={style.viewLibraryText}>
				<span className={style.viewLibraryTitle}>{view.title}</span>
				<span className={style.viewLibraryHint}>{hintFor(view, usable, openViews.has(view.id))}</span>
			</span>
		</button>
	);
};

/** A view with a collapsible list of second-level entries (collapsed by default). */
const ViewWithSubItems: React.FC<
	ViewLibraryProps & { view: WorkbenchViewType; subItems: RecoilValueReadOnly<ViewSubItem[]> }
> = props => {
	const { view, hasBlocks, onPick, onClose } = props;
	const items = useRecoilValue(props.subItems);
	const [expanded, setExpanded] = useState(false);
	const usable = isViewUsable(view, hasBlocks);

	// Nothing to choose from: behave like a plain entry (the panel explains how to create one).
	if (items.length === 0) {
		return <ViewItem {...props} />;
	}

	const Icon = view.icon;
	const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
	return (
		<>
			<button
				role="menuitem"
				aria-haspopup="true"
				aria-expanded={expanded}
				className={clsx(style.viewLibraryItem, !usable && style.disabled)}
				disabled={!usable}
				onClick={() => setExpanded(v => !v)}
			>
				<Icon className={style.viewLibraryIcon} />
				<span className={style.viewLibraryText}>
					<span className={style.viewLibraryTitle}>
						{view.title} <span className={style.viewLibraryCount}>({items.length})</span>
					</span>
					<span className={style.viewLibraryHint}>{usable ? view.description : hintFor(view, usable, false)}</span>
				</span>
				<Chevron className={clsx(style.viewLibraryIcon, style.viewLibraryChevron)} />
			</button>
			{expanded && usable && (
				<div className={style.viewLibrarySubmenu} role="group" aria-label={view.title}>
					{items.map(item => (
						<button
							key={item.key}
							role="menuitem"
							className={clsx(style.viewLibraryItem, style.viewLibrarySubItem)}
							onClick={() => {
								onPick(view.id, item.params);
								onClose();
							}}
						>
							<span className={style.viewLibraryText}>
								<span className={style.viewLibraryTitle}>{item.title}</span>
								{item.hint && <span className={style.viewLibraryHint}>{item.hint}</span>}
							</span>
						</button>
					))}
				</div>
			)}
		</>
	);
};
