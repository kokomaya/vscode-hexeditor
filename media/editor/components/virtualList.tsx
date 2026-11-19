// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Minimal fixed-row-height virtual list. Renders only the rows in (and just
 * around) the viewport, so tables/trees with thousands of NVM blocks stay
 * cheap even when several panels are visible at once.
 */

import React, { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

const OVERSCAN = 8;

export interface VirtualListHandle {
	/** Scroll so row `index` is visible (no-op if it already is). */
	scrollToIndex(index: number): void;
}

export interface VirtualListProps {
	rowCount: number;
	rowHeight: number;
	renderRow(index: number): React.ReactNode;
	/** Rendered above the rows inside the scroll area (e.g. a sticky header). */
	header?: React.ReactNode;
	/** Height of `header` in px (so scroll math accounts for it). */
	headerHeight?: number;
	/** Minimum content width (enables horizontal scrolling for wide tables). */
	minWidth?: number;
	className?: string;
}

export const VirtualList = React.forwardRef<VirtualListHandle, VirtualListProps>(
	({ rowCount, rowHeight, renderRow, header, headerHeight = 0, minWidth, className }, ref) => {
		const scrollRef = useRef<HTMLDivElement>(null);
		const [viewport, setViewport] = useState({ top: 0, height: 0 });

		const measure = useCallback(() => {
			const el = scrollRef.current;
			if (el && el.clientHeight > 0) {
				setViewport({ top: el.scrollTop, height: el.clientHeight });
			}
		}, []);

		useLayoutEffect(() => {
			const el = scrollRef.current;
			if (!el) {
				return;
			}
			measure();
			const observer = new ResizeObserver(measure);
			observer.observe(el);
			return () => observer.disconnect();
		}, [measure]);

		useImperativeHandle(
			ref,
			() => ({
				scrollToIndex(index: number) {
					const el = scrollRef.current;
					if (!el || index < 0) {
						return;
					}
					const rowTop = index * rowHeight;
					const visibleTop = el.scrollTop;
					const visibleBottom = visibleTop + el.clientHeight - headerHeight;
					if (rowTop < visibleTop) {
						el.scrollTop = rowTop;
					} else if (rowTop + rowHeight > visibleBottom) {
						el.scrollTop = rowTop + rowHeight - (el.clientHeight - headerHeight);
					}
				},
			}),
			[rowHeight, headerHeight],
		);

		const first = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN);
		const visibleCount = Math.ceil(viewport.height / rowHeight) + OVERSCAN * 2;
		const last = Math.min(rowCount, first + visibleCount);
		const rows: React.ReactNode[] = [];
		for (let i = first; i < last; i++) {
			rows.push(renderRow(i));
		}

		return (
			<div
				ref={scrollRef}
				className={className}
				style={{ overflow: "auto", height: "100%", position: "relative" }}
				onScroll={measure}
			>
				<div style={{ minWidth }}>
					{header}
					<div style={{ height: rowCount * rowHeight, position: "relative" }}>
						<div style={{ transform: `translateY(${first * rowHeight}px)` }}>{rows}</div>
					</div>
				</div>
			</div>
		);
	},
);
VirtualList.displayName = "VirtualList";
