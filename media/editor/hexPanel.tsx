// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The hex grid as a self-contained panel. It sizes itself from its OWN
 * container (not the window), so it renders correctly both full-window
 * (classic mode) and inside a workbench dock panel of any size.
 */

import React, { useLayoutEffect, useRef } from "react";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "recoil";
import { InspectorLocation } from "../../shared/protocol";
import { DataHeader } from "./dataDisplay";
import { DataInspectorHover } from "./dataInspector";
import { FindWidget } from "./findWidget";
import _style from "./hexEdit.css";
import { useTheme } from "./hooks";
import { ReadonlyWarning } from "./readonlyWarning";
import { ScrollContainer } from "./scrollContainer";
import { SettingsGear } from "./settings";
import * as select from "./state";
import { strings } from "./strings";
import { throwOnUndefinedAccessInDev } from "./util";

const style = throwOnUndefinedAccessInDev(_style);

/**
 * Keep `select.dimensions` in sync with the measured size of `ref`.
 * - Resizes are coalesced into one update per animation frame (smooth sash drags).
 * - A zero-sized container (hidden / background dock tab) is ignored, so the
 *   visible-row math never goes negative and the last good size is kept.
 */
const useContainerDimensions = (ref: React.RefObject<HTMLElement>) => {
	const setDimensions = useSetRecoilState(select.dimensions);
	const theme = useTheme();

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const rowPxHeight = parseInt(theme["editor-font-size"]) + 8;
		let frame: number | undefined;
		const apply = () => {
			frame = undefined;
			const { width, height } = el.getBoundingClientRect();
			if (width <= 0 || height <= 0) {
				return;
			}
			el.style.setProperty("--hex-panel-width", `${width}px`);
			el.style.setProperty("--hex-panel-height", `${height}px`);
			setDimensions(prev =>
				prev.width === width && prev.height === height && prev.rowPxHeight === rowPxHeight
					? prev
					: { width, height, rowPxHeight },
			);
		};
		const schedule = () => {
			if (frame === undefined) {
				frame = requestAnimationFrame(apply);
			}
		};
		apply();
		const observer = new ResizeObserver(schedule);
		observer.observe(el);
		return () => {
			observer.disconnect();
			if (frame !== undefined) {
				cancelAnimationFrame(frame);
			}
		};
	}, [theme]);
};

const LargeFilePrompt: React.FC<{ onOpen(): void }> = ({ onOpen }) => (
	<div>
		<p>
			{strings.openLargeFileWarning}{" "}
			<a id="open-anyway" role="button" onClick={onOpen}>
				{strings.openAnyways}
			</a>
		</p>
	</div>
);

export const HexPanel: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const dimensions = useRecoilValue(select.dimensions);
	const inspectorLocation = useRecoilValue(select.dataInspectorLocation);
	const isLargeFile = useRecoilValue(select.isLargeFile);
	const [bypassLargeFilePrompt, setBypassLargeFile] = useRecoilState(select.bypassLargeFilePrompt);
	useContainerDimensions(containerRef);

	const showPrompt = isLargeFile && !bypassLargeFilePrompt;
	return (
		<div
			ref={containerRef}
			className={style.container}
			data-vscode-context={JSON.stringify({ webviewSection: "hex" })}
			style={{ "--cell-size": `${dimensions.rowPxHeight}px` } as React.CSSProperties}
		>
			{showPrompt ? (
				<LargeFilePrompt onOpen={() => setBypassLargeFile(true)} />
			) : (
				<>
					<FindWidget />
					<SettingsGear />
					<DataHeader />
					<ScrollContainer />
					<ReadonlyWarning />
					{inspectorLocation === InspectorLocation.Hover && <DataInspectorHover />}
				</>
			)}
		</div>
	);
};
