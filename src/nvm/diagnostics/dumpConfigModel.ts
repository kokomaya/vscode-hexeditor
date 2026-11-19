// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Pure node model of the "Dump & Config" view: everything that decides how
 * the active dump is parsed, each with its state and the action that fixes it.
 * No vscode API here — the view maps nodes to TreeItems.
 */

import { explainLoad } from "./explainLoad";
import { NvmLoadDiagnosis } from "./loadDiagnostics";

export type NodeState = "ok" | "warning" | "error" | "info" | "loading";

export interface ConfigNode {
	id: string;
	label: string;
	description?: string;
	tooltip?: string;
	state: NodeState;
	/** Codicon to use instead of the state icon. */
	icon?: string;
	command?: { id: string; args?: unknown[] };
	children?: ConfigNode[];
}

export interface ConfigEnvironment {
	layoutMode: "workbench" | "classic";
	enginesAllowed: boolean;
	workspaceTrusted: boolean;
}

const statusState = (d: NvmLoadDiagnosis): NodeState =>
	d.status === "loaded"
		? "ok"
		: d.status === "loading"
			? "loading"
			: d.status === "error" || d.status === "noBlocks"
				? "error"
				: "warning";

export function buildConfigNodes(d: NvmLoadDiagnosis, env: ConfigEnvironment): ConfigNode[] {
	const explanation = explainLoad(d);
	const nodes: ConfigNode[] = [
		{
			id: "status",
			label: explanation.headline,
			tooltip: [explanation.headline, ...explanation.nextSteps.map(s => `• ${s}`)].join("\n"),
			state: statusState(d),
			command: { id: "nvmStudio.nvm.explainLoad" },
		},
		{
			id: "profile",
			label: "Layout profile",
			description: d.profile ?? "Auto",
			tooltip: "Which *.nvmlayout.json descriptor is used. Click to pin one.",
			state: "info",
			icon: "settings",
			command: { id: "nvmStudio.nvm.selectLayoutProfile" },
		},
	];

	nodes.push({
		id: "descriptors",
		label: "Descriptors",
		description: String(d.descriptors.length),
		state: d.descriptors.length ? "ok" : "warning",
		icon: "file-code",
		children: d.descriptors.length
			? d.descriptors.map((x, i) => ({ id: `descriptor:${i}`, label: x.name, description: x.via, state: "info" as const, icon: "file-code" }))
			: [{ id: "descriptor:none", label: "None found near the dump (./, ./conf, ../conf, layoutRoots)", state: "warning" }],
	});

	if (d.sources.length) {
		const missingRequired = d.sources.some(s => s.required && !s.resolved);
		nodes.push({
			id: "sources",
			label: "Source files",
			description: `${d.sources.filter(s => s.resolved).length}/${d.sources.length}`,
			state: missingRequired ? "error" : "ok",
			icon: "files",
			children: d.sources.map(s => ({
				id: `source:${s.logical}`,
				label: s.file,
				description: `${s.logical} · ${s.required ? "required" : "optional"}${s.resolved ? "" : " · missing"}`,
				state: s.resolved ? ("ok" as const) : s.required ? ("error" as const) : ("warning" as const),
				command: s.resolved ? undefined : { id: "nvmStudio.nvm.reselectDependency" },
			})),
		});
	}

	if (d.descriptors.some(x => x.usesEngine)) {
		const engineIssue = d.engineIssue;
		const blocked = !env.enginesAllowed || !env.workspaceTrusted || !!engineIssue;
		nodes.push({
			id: "engine",
			label: "External engine",
			description: !env.workspaceTrusted
				? "workspace not trusted"
				: !env.enginesAllowed
					? "disabled by setting"
					: engineIssue
						? "did not run"
						: "allowed",
			tooltip: engineIssue,
			state: blocked ? "error" : "ok",
			icon: "server-process",
			command: { id: !env.workspaceTrusted ? "workbench.trust.manage" : "nvmStudio.nvm.manageEngines" },
		});
	}

	nodes.push({
		id: "mode",
		label: "Editor layout",
		description: env.layoutMode === "workbench" ? "Workbench" : "Classic (hex only)",
		state: "info",
		icon: "layout",
		command: { id: "workbench.action.openSettings", args: ["nvmstudio.nvm.layoutMode"] },
	});
	return nodes;
}
