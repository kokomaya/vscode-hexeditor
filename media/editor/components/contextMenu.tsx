// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * A small in-webview context menu (VS Code's native webview menu cannot show
 * dynamic, checkable items). Rendered in a portal at the pointer position,
 * clamped to the viewport; closes on Escape, outside click or blur. Items
 * with `keepOpen` leave the menu open so several can be toggled in a row.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx, throwOnUndefinedAccessInDev } from "../util";
import _style from "./contextMenu.css";

const style = throwOnUndefinedAccessInDev(_style);

export interface ContextMenuItem {
	label: string;
	checked?: boolean;
	disabled?: boolean;
	keepOpen?: boolean;
	/** Draw a separator above this item. */
	separator?: boolean;
	onSelect(): void;
}

export interface ContextMenuProps {
	x: number;
	y: number;
	items: readonly ContextMenuItem[];
	onClose(): void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: x, top: y });
	const [active, setActive] = useState(() => items.findIndex(i => !i.disabled));

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const r = el.getBoundingClientRect();
		setPos({
			left: Math.max(0, Math.min(x, window.innerWidth - r.width - 2)),
			top: Math.max(0, Math.min(y, window.innerHeight - r.height - 2)),
		});
		el.focus();
	}, [x, y]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) {
				onClose();
			}
		};
		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("blur", onClose);
		return () => {
			window.removeEventListener("mousedown", onDown, true);
			window.removeEventListener("blur", onClose);
		};
	}, [onClose]);

	const choose = (item: ContextMenuItem | undefined) => {
		if (!item || item.disabled) {
			return;
		}
		item.onSelect();
		if (!item.keepOpen) {
			onClose();
		}
	};

	const move = (delta: number) => {
		for (let i = 1; i <= items.length; i++) {
			const next = (active + delta * i + items.length * i) % items.length;
			if (!items[next].disabled) {
				setActive(next);
				return;
			}
		}
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation();
		if (e.key === "Escape") {
			onClose();
		} else if (e.key === "ArrowDown") {
			move(1);
		} else if (e.key === "ArrowUp") {
			move(-1);
		} else if (e.key === "Enter" || e.key === " ") {
			choose(items[active]);
		} else {
			return;
		}
		e.preventDefault();
	};

	return createPortal(
		<div
			ref={ref}
			className={style.menu}
			style={pos}
			role="menu"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onContextMenu={e => e.preventDefault()}
		>
			{items.map((item, i) => (
				<React.Fragment key={`${i}:${item.label}`}>
					{item.separator && <div className={style.separator} role="separator" />}
					<div
						role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
						aria-checked={item.checked}
						aria-disabled={item.disabled}
						className={clsx(style.item, i === active && style.active, item.disabled && style.disabled)}
						onMouseEnter={() => !item.disabled && setActive(i)}
						onClick={() => choose(item)}
					>
						<span className={style.check}>{item.checked ? "✓" : ""}</span>
						<span className={style.label}>{item.label}</span>
					</div>
				</React.Fragment>
			))}
		</div>,
		document.body,
	);
};
