// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Reports the user's current focus (byte → owning NVM block / field) to the
 * extension host, debounced. The host uses it as "this" for @nvm questions
 * and shows it in the status bar. Works in classic and workbench mode.
 */

import { useEffect, useRef } from "react";
import { useRecoilValue } from "recoil";
import { NvmFocus } from "../../shared/nvm/workbench/commands";
import { MessageType } from "../../shared/protocol";
import { DisplayContext } from "./dataDisplayContext";
import * as select from "./state";

const REPORT_DEBOUNCE_MS = 150;

const sameFocus = (a: NvmFocus | undefined, b: NvmFocus | undefined) =>
	a?.offset === b?.offset && a?.blockId === b?.blockId && a?.fieldName === b?.fieldName;

export const useFocusReporter = (ctx: DisplayContext): void => {
	const ranges = useRecoilValue(select.nvmFieldRanges);
	const selectedBlock = useRecoilValue(select.selectedNvmBlockAtom);
	const rangesRef = useRef(ranges);
	rangesRef.current = ranges;
	const last = useRef<NvmFocus | undefined>();
	const timer = useRef<ReturnType<typeof setTimeout>>();

	const schedule = (offset: number | undefined) => {
		if (timer.current) {
			clearTimeout(timer.current);
		}
		timer.current = setTimeout(() => {
			const focus = offset === undefined ? undefined : resolveFocus(offset, rangesRef.current);
			if (!sameFocus(focus, last.current)) {
				last.current = focus;
				select.messageHandler.sendEvent({ type: MessageType.NvmFocusChanged, focus });
			}
		}, REPORT_DEBOUNCE_MS);
	};

	useEffect(() => {
		const d = ctx.onDidFocus(focused => schedule(focused?.byte));
		return () => {
			d.dispose();
			if (timer.current) {
				clearTimeout(timer.current);
			}
		};
	}, [ctx]);

	// A block picked in a structure view (no byte focus yet) is also a focus.
	useEffect(() => {
		if (selectedBlock && ctx.focusedElement?.byte === undefined) {
			schedule(selectedBlock.offset);
		}
	}, [selectedBlock?.id]);
};

function resolveFocus(offset: number, ranges: readonly select.NvmFieldRange[]): NvmFocus {
	const field = ranges.find(r => offset >= r.start && offset < r.end);
	if (!field) {
		return { offset };
	}
	return {
		offset,
		length: field.end - field.start,
		blockId: field.block.id,
		blockName: field.block.name ?? field.block.id,
		fieldName: field.fieldName !== (field.block.name ?? field.block.id) ? field.fieldName : undefined,
	};
}
