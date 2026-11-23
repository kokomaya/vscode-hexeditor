// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** Host ↔ webview contract of the NVM Resources panel (skills, layout configs, engines). */

export type ResourceKind = "skill" | "config" | "engine";

export type ResourceStatus = "installed" | "update" | "available" | "localOnly";

export interface ResourceRow {
	kind: ResourceKind;
	/** Skill: "<hierarchy>/<name>"; config: path under conf/; engine: "<vendor>/<pack>". */
	id: string;
	name: string;
	/** Hierarchy path / folder the item belongs to ("" = general / root). */
	group: string;
	description: string;
	localVersion?: string;
	remoteVersion?: string;
	local: boolean;
	remote: boolean;
	status: ResourceStatus;
	/** Visible in / planned for the current context. */
	inContext: boolean;
	/** In effect for the current dump (skill resolved / descriptor used). */
	active?: boolean;
	/** Where local copies come from (skill scopes, e.g. "user, builtin"). */
	scope?: string;
	/** Skill: active for the AI (undefined = not installed locally). */
	enabled?: boolean;
	/** Skill: false when SKILL.md itself says `enabled: false` (cannot be switched here). */
	toggleable?: boolean;
	/** Can be removed from the user folder. */
	removable: boolean;
}

export interface ContextNode {
	key: string;
	title: string;
	depth: number;
	level: string;
	local: boolean;
	remote: boolean;
	recent: boolean;
}

export interface DumpSummary {
	fileName: string;
	status: string;
	blockCount: number;
	provider?: string;
	descriptors: string[];
	missingSources: string[];
	engineIssue?: string;
	message?: string;
	activeSkills: string[];
}

export interface ResourcesState {
	server: { base: string; status: "none" | "connecting" | "online" | "error"; error?: string };
	context: { key: string; title: string; source: "setting" | "descriptor" | "none"; nodes: ContextNode[] };
	rows: ResourceRow[];
	/** References the server cannot satisfy for the current context. */
	missing: string[];
	dump?: DumpSummary;
	trusted: boolean;
	enginesAllowed: boolean;
}

export type ResourcesToHost =
	| { type: "ready" }
	| { type: "refresh" }
	| { type: "connect"; base: string }
	| { type: "setContext"; key: string }
	| { type: "install"; items: { kind: ResourceKind; id: string }[] }
	| { type: "installContext" }
	| { type: "remove"; kind: ResourceKind; id: string }
	| { type: "open"; kind: ResourceKind; id: string }
	| { type: "openSetting"; id: string }
	| { type: "toggleSkill"; name: string; enabled: boolean };

export type ResourcesToWebview = { type: "state"; state: ResourcesState };
