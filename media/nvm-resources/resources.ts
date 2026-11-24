// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/** NVM Resources panel webview (plain DOM): context tree + skills / conf / engines tables + dump status. */

import type {
	ContextNode,
	ResourceKind,
	ResourceRow,
	ResourcesState,
	ResourcesToHost,
	ResourcesToWebview,
} from "../../shared/nvm/resources/protocol";

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(s: unknown): void;
};

interface UiState {
	tab: ResourceKind;
	onlyContext: boolean;
	filter: string;
	/** Collapsed context-tree keys. */
	collapsed: string[];
}

const vscode = acquireVsCodeApi();
const ui: UiState = {
	tab: "skill",
	onlyContext: true,
	filter: "",
	collapsed: [],
	...((vscode.getState() as Partial<UiState>) ?? {}),
};
const selected = new Set<string>();
let state: ResourcesState | undefined;

const send = (m: ResourcesToHost) => vscode.postMessage(m);
const esc = (s: unknown) =>
	String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const rowKey = (r: { kind: string; id: string }) => `${r.kind}|${r.id}`;
const root = document.getElementById("root")!;

const TABS: { kind: ResourceKind; label: string }[] = [
	{ kind: "skill", label: "Skills" },
	{ kind: "config", label: "Conf / Descriptors" },
	{ kind: "engine", label: "Engines" },
];

const STATUS: Record<ResourceRow["status"], string> = {
	installed: "✓ installed",
	update: "⬆ update",
	available: "⬇ available",
	localOnly: "local only",
};

function visibleRows(s: ResourcesState): ResourceRow[] {
	const f = ui.filter.trim().toLowerCase();
	return s.rows
		.filter(r => r.kind === ui.tab)
		.filter(r => !ui.onlyContext || r.inContext || r.active)
		.filter(r => !f || `${r.name} ${r.group} ${r.description}`.toLowerCase().includes(f))
		.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

function serverBar(s: ResourcesState): string {
	const st = s.server;
	const dot = { none: "", connecting: "…", online: "● online", error: "● offline" }[st.status];
	return `<div class="bar">
		<label>Server</label>
		<input id="base" type="text" value="${esc(st.base)}" placeholder="10.1.2.3 | host:7788 | https://…" />
		<button data-action="connect">${st.status === "online" ? "Reconnect" : "Connect"}</button>
		<span class="status ${st.status}" title="${esc(st.error)}">${esc(dot)}</span>
		${st.checkedAt ? `<span class="muted" title="Re-checked automatically while this page is visible">checked ${esc(new Date(st.checkedAt).toLocaleTimeString())}</span>` : ""}
		${st.status === "online" && st.updates ? `<button data-action="updateAll" title="The server copy differs from the installed one (content or version)">⬆ Update all (${st.updates})</button>` : ""}
		${st.error ? `<span class="warn" title="${esc(st.error)}">${esc(st.error.slice(0, 120))}</span>` : ""}
		<span class="spacer"></span>
		<button class="secondary" data-action="refresh" title="Rescan local folders and the server">⟳ Refresh</button>
	</div>`;
}

function contextBar(s: ResourcesState): string {
	const c = s.context;
	const src =
		c.source === "descriptor"
			? `<span class="warn">set by the dump's layout descriptor (overrides the setting)</span>`
			: c.source === "setting"
				? `<span class="muted">from setting nvmstudio.nvm.skills.context</span>`
				: "";
	const canInstall = s.server.status === "online";
	return `<div class="bar">
		<label>Context</label>
		<strong>${esc(c.title || "General only")}</strong> ${src}
		<span class="spacer"></span>
		<button data-action="installContext" ${canInstall ? "" : "disabled"} title="Engine + descriptors + skills bound to this context on the server">Install everything for this context</button>
	</div>
	${s.missing.length ? `<div class="bar warn">Not on the server: ${esc(s.missing.join(", "))}</div>` : ""}`;
}

/** Hierarchical tree: General → product → platform → project, with twisties and indent guides. */
function contextTree(s: ResourcesState): string {
	const children = new Map<string, ContextNode[]>();
	for (const n of s.context.nodes) {
		const cut = n.key.lastIndexOf("/");
		const parent = cut < 0 ? "" : n.key.slice(0, cut);
		children.set(parent, [...(children.get(parent) ?? []), n]);
	}
	const cur = s.context.key;
	const onPath = (k: string) => k !== cur && (k === "" || cur.startsWith(`${k}/`));
	const badges = (n: ContextNode) =>
		[
			n.local ? "" : n.remote ? `<span class="b remote" title="only on the server — no local skills at this level">server</span>` : `<span class="b" title="no local skills at this level">empty</span>`,
			n.recent && n.key !== cur ? `<span class="b">recent</span>` : "",
		].join("");
	const row = (key: string, title: string, level: string, extra: string, tip: string) => {
		const hasKids = !!children.get(key)?.length;
		const open = hasKids && !ui.collapsed.includes(key);
		const twisty = hasKids
			? `<span class="twisty" data-action="twisty" data-key="${esc(key)}" title="${open ? "Collapse" : "Expand"}">${open ? "▾" : "▸"}</span>`
			: `<span class="twisty"></span>`;
		return `<div class="node ${key === cur ? "current" : ""} ${onPath(key) ? "onpath" : ""}" data-action="setContext" data-key="${esc(key)}" title="${esc(tip)}">
			${twisty}<span class="lvl lvl-${esc(level)}" title="${esc(level)}">${esc(level.charAt(0).toUpperCase())}</span><span class="label">${esc(title)}</span>${extra}</div>`;
	};
	const branch = (key: string): string => {
		const kids = children.get(key) ?? [];
		if (!kids.length || ui.collapsed.includes(key)) {
			return "";
		}
		return `<ul>${kids
			.map(n => `<li>${row(n.key, n.title, n.level, badges(n), `${n.level}: ${n.key}`)}${branch(n.key)}</li>`)
			.join("")}</ul>`;
	};
	return `<aside><div class="head">Product / platform / project</div>
		<div class="tree"><ul class="top"><li>${row("", "General", "general", "", "General skills only — no product / platform / project")}${branch("")}</li></ul></div>
		${s.context.nodes.length ? "" : `<p class="muted pad">Connect to a server to see its products / projects.</p>`}
		<div class="legend muted"><span class="lvl lvl-product">P</span>product <span class="lvl lvl-platform">P</span>platform <span class="lvl lvl-project">P</span>project</div></aside>`;
}

function table(s: ResourcesState): string {
	const rows = visibleRows(s);
	const online = s.server.status === "online";
	const count = (k: ResourceKind) => s.rows.filter(r => r.kind === k && (!ui.onlyContext || r.inContext || r.active)).length;
	const updates = (k: ResourceKind) => s.rows.filter(r => r.kind === k && r.status === "update").length;
	const tabs = TABS.map(t => {
		const u = updates(t.kind);
		const badge = u ? ` <span class="n" title="${u} update(s) on the server">⬆${u}</span>` : "";
		return `<button class="tab ${ui.tab === t.kind ? "on" : ""}" data-action="tab" data-kind="${t.kind}">${t.label} <span class="n">${count(t.kind)}</span>${badge}</button>`;
	}).join("");
	const installable = rows.filter(r => r.remote && r.status !== "installed");
	const engineNote =
		ui.tab === "engine" && (!s.trusted || !s.enginesAllowed)
			? `<div class="bar warn">Engines are code: they run only in a trusted workspace with <a href="#" data-action="openSetting" data-id="nvmstudio.nvm.allowExternalEngines">nvmstudio.nvm.allowExternalEngines</a> on${s.trusted ? "" : " (workspace is untrusted)"}.</div>`
			: "";
	const body = rows
		.map(r => {
			const k = rowKey(r);
			const ver = r.localVersion || r.remoteVersion ? `${esc(r.localVersion ?? "—")} / ${esc(r.remoteVersion ?? "—")}` : "";
			const actions = [
				r.remote && online && r.status !== "installed" ? `<button data-action="install" data-kind="${r.kind}" data-id="${esc(r.id)}">${r.status === "update" ? "Update" : "Install"}</button>` : "",
				r.remote && online && r.status === "installed" ? `<button class="secondary" data-action="install" data-kind="${r.kind}" data-id="${esc(r.id)}" title="Download again">Reinstall</button>` : "",
				r.local ? `<button class="secondary" data-action="open" data-kind="${r.kind}" data-id="${esc(r.id)}">Open</button>` : "",
				r.removable ? `<button class="secondary danger" data-action="remove" data-kind="${r.kind}" data-id="${esc(r.id)}">Remove</button>` : "",
			].join("");
			const toggle =
				r.kind === "skill" && r.enabled !== undefined
					? `<label class="switch" title="${r.toggleable ? (r.enabled ? "Active — the AI can use this skill. Click to deactivate." : "Inactive — the AI cannot use this skill. Click to activate.") : "Disabled by enabled: false in SKILL.md"}"><input type="checkbox" data-action="toggleSkill" data-name="${esc(r.name)}" ${r.enabled ? "checked" : ""} ${r.toggleable ? "" : "disabled"} /><span class="slider"></span></label>`
					: "";
			return `<tr class="${r.active ? "active" : ""} ${r.enabled === false ? "inactive" : ""}">
				<td><input type="checkbox" data-action="select" data-key="${esc(k)}" ${selected.has(k) ? "checked" : ""} ${r.remote && online ? "" : "disabled"} /></td>
				<td class="name" title="${esc(r.description)}">${toggle}${r.active && r.enabled !== false ? `<span class="b on" title="in effect for the current dump">active</span> ` : ""}${r.enabled === false ? `<span class="b off">inactive</span> ` : ""}${esc(r.name)}<div class="muted">${esc(r.description)}</div></td>
				<td class="muted">${esc(r.group || "(general)")}${r.scope ? `<div>${esc(r.scope)}</div>` : ""}</td>
				<td class="muted">${ver}</td>
				<td><span class="st ${r.status}">${STATUS[r.status]}</span></td>
				<td class="actions">${actions}</td>
			</tr>`;
		})
		.join("");
	const nSel = [...selected].filter(k => k.startsWith(`${ui.tab}|`)).length;
	return `<main>
		<div class="tabs">${tabs}</div>
		<div class="bar">
			<label class="chk"><input type="checkbox" data-action="onlyContext" ${ui.onlyContext ? "checked" : ""}/> Only current context</label>
			<input id="filter" type="search" placeholder="Filter…" value="${esc(ui.filter)}" />
			<span class="spacer"></span>
			<button data-action="selectAll" ${online && installable.length ? "" : "disabled"}>Select installable (${installable.length})</button>
			<button data-action="installSelected" ${online && nSel ? "" : "disabled"}>Install selected (${nSel})</button>
		</div>
		${engineNote}
		<table><thead><tr><th></th><th>Name</th><th>Folder</th><th>Local / server</th><th>Status</th><th></th></tr></thead>
		<tbody>${body || `<tr><td colspan="6" class="muted pad">Nothing here${ui.onlyContext ? " for this context — untick “Only current context”" : ""}.</td></tr>`}</tbody></table>
	</main>`;
}

function dumpPanel(s: ResourcesState): string {
	const d = s.dump;
	if (!d) {
		return `<footer><div class="head">Current dump</div><p class="muted pad">Open an NVM dump to see which descriptor, engine and skills it uses.</p></footer>`;
	}
	const line = (label: string, value: string, cls = "") => (value ? `<div class="${cls}"><label>${label}</label> ${value}</div>` : "");
	return `<footer><div class="head">Current dump — ${esc(d.fileName)}</div><div class="grid">
		${line("Status", `${esc(d.status)} · ${d.blockCount} block(s)`)}
		${line("Provider", esc(d.provider ?? ""))}
		${line("Descriptors", esc(d.descriptors.join(", ") || "none found"))}
		${line("Missing sources", esc(d.missingSources.join("; ")), "warn")}
		${line("Engine", esc(d.engineIssue ?? ""), "warn")}
		${line("Note", esc(d.message ?? ""))}
		${line("Active skills", esc(d.activeSkills.join(", ") || "none"))}
	</div></footer>`;
}

function render(): void {
	if (!state) {
		root.innerHTML = `<p class="muted pad">Loading…</p>`;
		return;
	}
	const focus = document.activeElement?.id;
	// Keep a server address being typed when a state update re-renders.
	const typedBase = focus === "base" ? (document.getElementById("base") as HTMLInputElement).value : undefined;
	root.innerHTML = `${serverBar(state)}${contextBar(state)}<div class="split">${contextTree(state)}${table(state)}</div>${dumpPanel(state)}`;
	if (focus) {
		const el = document.getElementById(focus) as HTMLInputElement | null;
		if (el && typedBase !== undefined) {
			el.value = typedBase;
		}
		el?.focus();
		el?.setSelectionRange?.(el.value.length, el.value.length);
	}
}

const saveUi = () => vscode.setState(ui);

root.addEventListener("click", ev => {
	const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
	if (!el || !state || (el as HTMLButtonElement).disabled) {
		return;
	}
	const { action, kind, id, key } = el.dataset;
	switch (action) {
		case "connect":
			return send({ type: "connect", base: (document.getElementById("base") as HTMLInputElement).value });
		case "refresh":
			return send({ type: "refresh" });
		case "setContext":
			return send({ type: "setContext", key: key ?? "" });
		case "twisty":
			ev.stopPropagation();
			ui.collapsed = ui.collapsed.includes(key!) ? ui.collapsed.filter(k => k !== key) : [...ui.collapsed, key!];
			saveUi();
			return render();
		case "toggleSkill":
			return send({ type: "toggleSkill", name: el.dataset.name!, enabled: (el as HTMLInputElement).checked });
		case "installContext":
			return send({ type: "installContext" });
		case "updateAll":
			return send({ type: "updateAll" });
		case "tab":
			ui.tab = kind as ResourceKind;
			saveUi();
			return render();
		case "onlyContext":
			ui.onlyContext = (el as HTMLInputElement).checked;
			saveUi();
			return render();
		case "select":
			if ((el as HTMLInputElement).checked) {
				selected.add(key!);
			} else {
				selected.delete(key!);
			}
			return render();
		case "selectAll":
			visibleRows(state)
				.filter(r => r.remote && r.status !== "installed")
				.forEach(r => selected.add(rowKey(r)));
			return render();
		case "installSelected": {
			const items = [...selected]
				.filter(k => k.startsWith(`${ui.tab}|`))
				.map(k => ({ kind: ui.tab, id: k.slice(ui.tab.length + 1) }));
			items.forEach(i => selected.delete(rowKey(i)));
			return send({ type: "install", items });
		}
		case "install":
			return send({ type: "install", items: [{ kind: kind as ResourceKind, id: id! }] });
		case "remove":
			return send({ type: "remove", kind: kind as ResourceKind, id: id! });
		case "open":
			return send({ type: "open", kind: kind as ResourceKind, id: id! });
		case "openSetting":
			ev.preventDefault();
			return send({ type: "openSetting", id: id! });
	}
});

root.addEventListener("input", ev => {
	const el = ev.target as HTMLInputElement;
	if (el.id === "filter") {
		ui.filter = el.value;
		saveUi();
		render();
	}
});

root.addEventListener("keydown", ev => {
	if ((ev.target as HTMLElement).id === "base" && ev.key === "Enter") {
		send({ type: "connect", base: (ev.target as HTMLInputElement).value });
	}
});

window.addEventListener("message", (ev: MessageEvent<ResourcesToWebview>) => {
	if (ev.data?.type === "state") {
		state = ev.data.state;
		render();
	}
});

render();
send({ type: "ready" });
