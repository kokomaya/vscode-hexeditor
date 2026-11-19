// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** LM tool: explain the active dump's NVM load status (thin adapter). */

import * as vscode from "vscode";
import { guarded, LmApi } from "./lmToolKit";
import { NvmCapabilities } from "./nvmCapabilities";

export function registerStatusTools(lm: LmApi, caps: NvmCapabilities): vscode.Disposable[] {
	return [
		lm.registerTool("nvm_loadStatus", {
			invoke: async () => guarded(() => caps.status.explainText()),
		}),
	];
}
