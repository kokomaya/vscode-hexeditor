// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Root of the editor webview. Provides the shared hex display context (so the
 * hex grid and a separately docked Inspector share one selection), then picks
 * the UI mode: the classic full-window hex editor, or the NVM workbench.
 */

import React, { Suspense, useMemo } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { DataDisplayContext, DisplayContext } from "./dataDisplayContext";
import { useFocusReporter } from "./focusReporter";
import { HexPanel } from "./hexPanel";
import * as select from "./state";
import { VsProgressIndicator } from "./vscodeUi";
import { Workbench } from "./workbench/workbench";

const EditorRoot: React.FC = () => {
	const mode = useRecoilValue(select.layoutMode);
	const setEdit = useSetRecoilState(select.edits);
	const isReadonly = useRecoilValue(select.isReadonly);
	const ctx = useMemo(() => new DisplayContext(setEdit, isReadonly), []);
	useFocusReporter(ctx);

	return (
		<DataDisplayContext.Provider value={ctx}>
			{mode === "classic" ? <HexPanel /> : <Workbench />}
		</DataDisplayContext.Provider>
	);
};

export const App: React.FC = () => (
	<Suspense fallback={<VsProgressIndicator />}>
		<EditorRoot />
	</Suspense>
);
