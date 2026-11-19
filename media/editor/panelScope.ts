// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Keyboard scope for multi-panel layouts. Window-level shortcuts (Ctrl+F,
 * arrow navigation) must only act on the panel the user is working in. The
 * workbench writes the active panel's view id here; in classic mode it stays
 * `undefined`, which means "the hex editor owns the keyboard" (legacy behavior).
 */

import { useEffect, useRef } from "react";
import { atom, useRecoilValue } from "recoil";

/** View id of the hex panel (kept here so hex code doesn't depend on the workbench). */
export const HEX_SCOPE = "nvm.hex";

/** View id of the active workbench panel, or undefined outside the workbench. */
export const activePanelAtom = atom<string | undefined>({
	key: "activePanel",
	default: undefined,
});

/** Whether the panel with view id `scope` currently owns window-level keys. */
export const useOwnsKeyboard = (scope: string): boolean => {
	const active = useRecoilValue(activePanelAtom);
	return active === undefined || active === scope;
};

/** Like {@link useOwnsKeyboard}, as a ref readable from long-lived listeners. */
export const useOwnsKeyboardRef = (scope: string): React.MutableRefObject<boolean> => {
	const owns = useOwnsKeyboard(scope);
	const ref = useRef(owns);
	useEffect(() => {
		ref.current = owns;
	}, [owns]);
	return ref;
};
