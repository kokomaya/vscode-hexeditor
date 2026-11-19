// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * View library popover: every registered view, with unusable ones greyed out
 * and the reason shown. Picking a view opens it (or focuses the open
 * singleton).
 */

import React, { useEffect, useRef } from "react";
import { SINGLETON_VIEWS } from "../../../shared/nvm/workbench/viewIds";
import { clsx, throwOnUndefinedAccessInDev } from "../util";
import { isViewUsable, viewRegistry } from "./registry";
import _style from "./workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

export const ViewLibrary: React.FC<{
	hasBlocks: boolean;
	openViews: ReadonlySet<string>;
	onPick(viewId: string): void;
	onClose(): void;
}> = ({ hasBlocks, openViews, onPick, onClose }) => {
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
			{viewRegistry.all().map(view => {
				const usable = isViewUsable(view, hasBlocks);
				const isOpen = openViews.has(view.id);
				const Icon = view.icon;
				const hint = !usable
					? "Needs a recognized NVM layout"
					: isOpen && SINGLETON_VIEWS.has(view.id)
						? "Open — click to focus"
						: view.description;
				return (
					<button
						key={view.id}
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
							<span className={style.viewLibraryHint}>{hint}</span>
						</span>
					</button>
				);
			})}
		</div>
	);
};
