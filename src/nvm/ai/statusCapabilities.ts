// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Status capabilities (`caps.status`): why the active dump was / wasn't
 * recognized, with next steps. Backs `@nvm /why` and `nvm_loadStatus`.
 */

import { HexEditorRegistry } from "../../hexEditorRegistry";
import { explainLoad, formatExplanation, LoadExplanation } from "../diagnostics/explainLoad";
import { LoadDiagnosticsStore, NvmLoadDiagnosis } from "../diagnostics/loadDiagnostics";

export class StatusCapabilities {
	constructor(
		private readonly registry: HexEditorRegistry,
		private readonly diagnostics?: LoadDiagnosticsStore,
	) {}

	public diagnosis(): NvmLoadDiagnosis | undefined {
		const doc = this.registry.activeDocument;
		return doc ? this.diagnostics?.get(doc.uri) : undefined;
	}

	public explain(): LoadExplanation {
		return explainLoad(this.diagnosis());
	}

	/** Markdown explanation of the active dump's load status. */
	public explainText(): string {
		return formatExplanation(this.explain());
	}
}
