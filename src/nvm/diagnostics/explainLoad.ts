// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Turns an {@link NvmLoadDiagnosis} into a plain-language explanation with
 * concrete next steps. Pure (no vscode API) so the chat `/why`, the LM tool
 * and the tree tooltip all say the same thing.
 */

import { NvmLoadDiagnosis } from "./loadDiagnostics";

export interface LoadExplanation {
	headline: string;
	details: string[];
	nextSteps: string[];
}

export function explainLoad(d: NvmLoadDiagnosis | undefined): LoadExplanation {
	if (!d) {
		return {
			headline: "No dump is open in the NVM editor.",
			details: [],
			nextSteps: ["Open an NVM dump (e.g. a .mot / .s19 / .hex file) with NVM Studio."],
		};
	}
	const details: string[] = [];
	for (const desc of d.descriptors) {
		details.push(`Descriptor "${desc.name}" (${desc.via})`);
	}
	if (d.profile) {
		details.push(`Pinned layout profile: ${d.profile}`);
	}
	for (const s of d.sources) {
		details.push(
			`Source ${s.resolved ? "OK" : "MISSING"} [${s.required ? "required" : "optional"}] ${s.logical} -> ${s.file}`,
		);
	}
	if (d.engineIssue) {
		details.push(d.engineIssue);
	}
	if (d.message) {
		details.push(d.message);
	}
	const missingRequired = d.sources.filter(s => s.required && !s.resolved);

	switch (d.status) {
		case "unsupported":
			return {
				headline: `${d.fileName} is not an NVM image format the loader reads (S-record / Intel HEX), so it is shown as plain hex.`,
				details,
				nextSteps: ["Open the dump as .mot/.srec/.s19/.s28/.s37/.hex/.ihex."],
			};
		case "loading":
			return { headline: `Still loading ${d.fileName}…`, details, nextSteps: [] };
		case "noDescriptor":
			return {
				headline: `No *.nvmlayout.json descriptor was found for ${d.fileName}.`,
				details,
				nextSteps: [
					`Put a descriptor next to the dump, in ${d.dir}/conf or ../conf, or in a configured nvmstudio.nvm.layoutRoots folder.`,
					"Install your team's configs (NVM: Install Layout Configs from URL…) or vendor pack.",
					"Start from docs/nvmlayout.template.jsonc.",
				],
			};
		case "noBlocks": {
			const steps: string[] = [];
			if (missingRequired.length) {
				steps.push(`Provide the missing required source file(s): ${missingRequired.map(s => s.file).join(", ")} (or add their folder to nvmstudio.nvm.workspaceRoots).`);
			}
			if (d.engineIssue) {
				steps.push(`Fix the engine: ${d.engineIssue}`);
			} else if (d.descriptors.some(x => x.usesEngine)) {
				steps.push("The descriptor uses an external engine: trust the workspace, enable nvmstudio.nvm.allowExternalEngines and confirm the engine prompt.");
			}
			if (d.descriptors.length > 1 && !d.profile) {
				steps.push("Several descriptors were found — pin the right one with NVM: Select Layout Profile.");
			}
			steps.push("Check the descriptor's match rules against this file and see the NVM Studio log for parse errors.");
			return {
				headline: `Descriptor(s) were found, but none produced NVM blocks for ${d.fileName}.`,
				details,
				nextSteps: steps,
			};
		}
		case "error":
			return {
				headline: `Loading the NVM layout for ${d.fileName} failed.`,
				details,
				nextSteps: ["See the NVM Studio log, fix the descriptor/engine, then run NVM: Reload Layout."],
			};
		case "loaded":
			return {
				headline: `${d.blockCount} NVM blocks loaded for ${d.fileName}${d.providerId ? ` via ${d.providerId}` : ""}.`,
				details,
				nextSteps: missingRequired.length
					? [`Parsing may be incomplete — missing required source(s): ${missingRequired.map(s => s.file).join(", ")}.`]
					: [],
			};
	}
}

/** Markdown rendering for chat / tool output. */
export function formatExplanation(e: LoadExplanation): string {
	const out = [`**${e.headline}**`];
	if (e.details.length) {
		out.push("", ...e.details.map(d => `- ${d}`));
	}
	if (e.nextSteps.length) {
		out.push("", "Next steps:", ...e.nextSteps.map((s, i) => `${i + 1}. ${s}`));
	}
	return out.join("\n");
}
