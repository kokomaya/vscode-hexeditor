// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The Data Inspector as an independent workbench panel (decoded block tree,
 * tags, notes, primitive types). While it is open the hex grid hides its own
 * aside/hover inspector, so the user decides where — or whether — it shows.
 */

import React, { useEffect, useState } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { EmptyState } from "../../components/emptyState";
import { DataInspectorAside } from "../../dataInspector";
import * as select from "../../state";
import { throwOnUndefinedAccessInDev } from "../../util";
import { WorkbenchPanelProps } from "../registry";
import _style from "../workbench.css";

const style = throwOnUndefinedAccessInDev(_style);

export const InspectorPanel: React.FC<WorkbenchPanelProps> = () => {
	const setDocked = useSetRecoilState(select.inspectorDockedAtom);
	const selectedBlock = useRecoilValue(select.selectedNvmBlockAtom);
	const [inspecting, setInspecting] = useState(false);

	useEffect(() => {
		setDocked(true);
		return () => setDocked(false);
	}, []);

	return (
		<div
			className={style.scrollPanel}
			style={{ "--hex-panel-width": "100%" } as React.CSSProperties}
		>
			{!inspecting && !selectedBlock && (
				<EmptyState
					title="Nothing selected"
					message="Click a byte in the hex view or a row in the Blocks table to inspect it."
				/>
			)}
			<DataInspectorAside onInspecting={setInspecting} />
		</div>
	);
};
