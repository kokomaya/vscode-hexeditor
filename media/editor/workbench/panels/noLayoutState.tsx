// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Shared "no NVM layout recognized" guidance for structure views. */

import React from "react";
import { EmptyState } from "../../components/emptyState";
import { askAi, runHostAction } from "../hostLink";

export const NoLayoutState: React.FC = () => (
	<EmptyState
		title="No NVM layout recognized for this dump"
		message="NVM Studio activates when a *.nvmlayout.json descriptor next to the dump (or in ./conf, ../conf) matches this file. Until then this file is shown as plain hex."
		actions={[
			{ label: "Select layout profile…", primary: true, onClick: () => runHostAction("selectLayoutProfile") },
			{ label: "Reload layout", onClick: () => runHostAction("reloadLayout") },
			{
				label: "Ask @nvm why",
				onClick: () => askAi("Why was no NVM layout recognized for this dump? What is missing?"),
			},
		]}
	/>
);
