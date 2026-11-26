// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Blocks Table panel: the primary structured view. Computes the vendor-neutral
 * table model directly from the blocks the editor webview already holds (no
 * host round-trip), and is two-way linked with the hex grid through the shared
 * Recoil selection: clicking a row reveals the block; selecting bytes in the
 * hex grid scrolls the owning row into view. The table itself lives in
 * {@link BlocksTableView} (shared with custom views).
 */

import React from "react";
import { useRecoilValue } from "recoil";
import { BlocksTableParams } from "../../../../../shared/nvm/workbench/viewIds";
import * as select from "../../../state";
import { WorkbenchPanelProps } from "../../registry";
import { NoLayoutState } from "../noLayoutState";
import { BlocksTableView } from "./blocksTableView";

export const BlocksTablePanel: React.FC<WorkbenchPanelProps<BlocksTableParams>> = ({
	params,
	setParams,
}) => {
	const blocks = useRecoilValue(select.nvmBlocksAtom);
	if (blocks.length === 0) {
		return <NoLayoutState />;
	}
	return <BlocksTableView blocks={blocks} query={params} onQuery={setParams} toolbar addAction />;
};
