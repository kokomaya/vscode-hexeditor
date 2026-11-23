// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * "NVM: Open Resources": one editor-area page that shows skills, layout
 * descriptors (conf) and engines side by side — local copy vs. install server,
 * which apply to the current product / platform / project context, and what
 * the active dump actually uses. Installs go through the same code paths as
 * the commands (engines keep their modal confirmation).
 */

import * as vscode from "vscode";
import { InstallPlan, planInstall, ServerCatalog } from "../../../shared/nvm/install/installPlan";
import { normalizeServerBase } from "../../../shared/nvm/install/serverAddress";
import {
	ContextNode,
	ResourceRow,
	ResourcesState,
	ResourcesToHost,
	ResourcesToWebview,
} from "../../../shared/nvm/resources/protocol";
import { formatHierarchyPath, levelOf, parseHierarchyPath, visibleIn } from "../../../shared/nvm/skills/hierarchy";
import { SkillMeta } from "../../../shared/nvm/skills/types";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { LoadDiagnosticsStore } from "../diagnostics/loadDiagnostics";
import { lastServerBase, rememberServerBase } from "../discovery/installServer";
import { EngineManager, InstalledEngine } from "../engines/engineManager";
import { fetchCatalog } from "../install/serverCatalog";
import { runInstallPlan } from "../install/serverInstall";
import { nvmStudioConfUri, nvmStudioSkillsUri } from "../paths";
import { contextCandidates, forgetSkillVersion, installedSkillVersion } from "../skills/contextMemory";
import { configuredSkillContext, writeSkillContext } from "../skills/skillContextCommand";
import { SkillRegistry } from "../skills/skillRegistry";
import { disabledSkillNames, setSkillsEnabled } from "../skills/skillToggle";

export const OPEN_RESOURCES_COMMAND = "nvmStudio.nvm.openResources";

interface Deps {
	context: vscode.ExtensionContext;
	skills: SkillRegistry;
	registry: HexEditorRegistry;
	engines: EngineManager;
	diagnostics: LoadDiagnosticsStore;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const skillId = (m: SkillMeta) => formatHierarchyPath([...(m.hierarchy ?? []), m.name]);
const statusOf = (local: boolean, remote: boolean, lv?: string, rv?: string): ResourceRow["status"] =>
	local && remote ? (lv && rv && lv !== rv ? "update" : "installed") : local ? "localOnly" : "available";

function randomNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** Descriptor files under the user conf folder, as paths relative to it. */
async function localConfigs(root: vscode.Uri, rel: string[] = [], depth = 0, out: string[] = []): Promise<string[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, ...rel));
	} catch {
		return out;
	}
	for (const [name, type] of entries) {
		if (type === vscode.FileType.Directory && depth < 6) {
			await localConfigs(root, [...rel, name], depth + 1, out);
		} else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".nvmlayout.json")) {
			out.push([...rel, name].join("/"));
		}
	}
	return out;
}

class ResourcesPanel {
	private static current?: ResourcesPanel;

	private base: string;
	private status: ResourcesState["server"]["status"] = "none";
	private serverError?: string;
	private catalog?: ServerCatalog;
	private lastDump?: vscode.Uri;
	private pending?: ReturnType<typeof setTimeout>;
	private readonly disposables: vscode.Disposable[] = [];

	public static show(deps: Deps): void {
		if (ResourcesPanel.current) {
			ResourcesPanel.current.panel.reveal();
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			"nvmStudio.resources",
			vscode.l10n.t("NVM Resources"),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(deps.context.extensionUri, "dist")],
			},
		);
		ResourcesPanel.current = new ResourcesPanel(panel, deps);
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly deps: Deps,
	) {
		this.base = lastServerBase(deps.context) ?? "";
		this.lastDump = deps.registry.activeDocument?.uri;
		panel.iconPath = new vscode.ThemeIcon("dashboard");
		panel.webview.html = this.html();
		this.disposables.push(
			panel.onDidDispose(() => this.dispose()),
			panel.webview.onDidReceiveMessage((m: ResourcesToHost) => void this.onMessage(m)),
			deps.skills.onDidChange(() => this.schedule()),
			deps.diagnostics.onDidChange(() => this.schedule()),
			deps.registry.onDidChangeActiveDocument(doc => {
				// Focusing this panel clears the active hex document: keep the last dump.
				if (doc) {
					this.lastDump = doc.uri;
					this.schedule();
				}
			}),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration("nvmstudio.nvm")) {
					this.schedule();
				}
			}),
		);
	}

	private dispose(): void {
		ResourcesPanel.current = undefined;
		clearTimeout(this.pending);
		this.disposables.forEach(d => d.dispose());
	}

	private schedule(): void {
		clearTimeout(this.pending);
		this.pending = setTimeout(() => void this.post(), 150);
	}

	private async post(): Promise<void> {
		try {
			const msg: ResourcesToWebview = { type: "state", state: await this.state() };
			await this.panel.webview.postMessage(msg);
		} catch (e) {
			console.error("NVM Resources: state failed", e);
		}
	}

	private async connect(base: string): Promise<void> {
		const normalized = normalizeServerBase(base);
		if (!normalized) {
			this.status = "error";
			this.serverError = vscode.l10n.t("Enter an IP, host name or http(s) URL");
			return this.post();
		}
		this.base = normalized;
		this.status = "connecting";
		this.serverError = undefined;
		await this.post();
		const { catalog, errors } = await fetchCatalog(normalized);
		if (errors.length === 3) {
			this.catalog = undefined;
			this.status = "error";
			this.serverError = errors.join("; ");
		} else {
			this.catalog = catalog;
			this.status = "online";
			this.serverError = errors.length ? errors.join("; ") : undefined;
			await rememberServerBase(this.deps.context, normalized);
		}
		await this.post();
	}

	private async onMessage(m: ResourcesToHost): Promise<void> {
		try {
			switch (m.type) {
				case "ready":
					await this.post();
					if (this.base && !this.catalog) {
						await this.connect(this.base);
					}
					return;
				case "refresh":
					this.deps.skills.reload();
					return this.base ? this.connect(this.base) : this.post();
				case "connect":
					return this.connect(m.base);
				case "setContext":
					await writeSkillContext(m.key);
					return this.post();
				case "install":
					return this.install(this.planFor(m.items));
				case "installContext": {
					if (this.catalog) {
						const context = this.deps.skills.contextFor(this.lastDump?.fsPath);
						return this.install(planInstall(this.catalog, context));
					}
					return;
				}
				case "remove":
					return this.remove(m.kind, m.id);
				case "open":
					return this.open(m.kind, m.id);
				case "toggleSkill":
					await setSkillsEnabled([m.name], m.enabled);
					return;
				case "openSetting":
					await vscode.commands.executeCommand("workbench.action.openSettings", m.id);
					return;
			}
		} catch (e) {
			void vscode.window.showErrorMessage(`NVM Resources: ${errorText(e)}`);
		}
	}

	private planFor(items: { kind: string; id: string }[]): InstallPlan {
		const c = this.catalog;
		const want = (kind: string) => new Set(items.filter(i => i.kind === kind).map(i => i.id));
		const [skills, configs, engines] = [want("skill"), want("config"), want("engine")];
		return {
			skills: c?.skills.skills.filter(s => skills.has(s.id)) ?? [],
			configs: c?.configs.filter(x => configs.has(x.path)) ?? [],
			engines: c?.engines.engines.filter(e => engines.has(e.id)) ?? [],
			missing: [],
		};
	}

	private async install(plan: InstallPlan): Promise<void> {
		if (!this.base || !this.catalog) {
			void vscode.window.showWarningMessage(vscode.l10n.t("Connect to an NVM server first."));
			return;
		}
		if (!plan.engines.length && !plan.configs.length && !plan.skills.length) {
			void vscode.window.showInformationMessage(vscode.l10n.t("Nothing to install."));
			return;
		}
		const lines = await runInstallPlan(this.base, plan, this.deps.engines);
		if (!lines) {
			return;
		}
		if (plan.missing.length) {
			lines.push(`not on the server: ${plan.missing.join(", ")}`);
		}
		this.deps.skills.reload();
		await this.post();
		void vscode.window.showInformationMessage(`Installed:\n- ${lines.join("\n- ")}`);
	}

	private async localTarget(kind: string, id: string): Promise<{ uri: vscode.Uri; engine?: InstalledEngine } | undefined> {
		if (kind === "skill") {
			const all = await this.deps.skills.listAll(this.lastDump?.fsPath);
			const meta = all.find(s => skillId(s) === id && s.scope === "user") ?? all.find(s => skillId(s) === id);
			return meta && { uri: vscode.Uri.file(meta.dir) };
		}
		if (kind === "config") {
			return { uri: vscode.Uri.joinPath(nvmStudioConfUri(), ...id.split("/")) };
		}
		const engine = (await this.deps.engines.list()).find(e => e.ref === id);
		return engine && { uri: engine.dir, engine };
	}

	private async remove(kind: string, id: string): Promise<void> {
		const target = await this.localTarget(kind, id);
		if (!target) {
			return;
		}
		if (kind === "skill" && !target.uri.fsPath.startsWith(nvmStudioSkillsUri().fsPath)) {
			void vscode.window.showWarningMessage(vscode.l10n.t("Only skills in the user folder can be removed here: {0}", target.uri.fsPath));
			return;
		}
		const ok = vscode.l10n.t("Remove");
		const answer = await vscode.window.showWarningMessage(
			vscode.l10n.t("Remove {0} \"{1}\"?\n{2}", kind, id, target.uri.fsPath),
			{ modal: true },
			ok,
		);
		if (answer !== ok) {
			return;
		}
		if (target.engine) {
			await this.deps.engines.remove(target.engine);
		} else {
			await vscode.workspace.fs.delete(target.uri, { recursive: true, useTrash: true });
		}
		if (kind === "skill") {
			forgetSkillVersion(id);
		}
		this.deps.skills.reload();
		await this.post();
	}

	private async open(kind: string, id: string): Promise<void> {
		const target = await this.localTarget(kind, id);
		if (!target) {
			return;
		}
		const file =
			kind === "skill" ? vscode.Uri.joinPath(target.uri, "SKILL.md") : kind === "engine" ? vscode.Uri.joinPath(target.uri, "engine.json") : target.uri;
		await vscode.window.showTextDocument(file, { preview: true, viewColumn: vscode.ViewColumn.Beside });
	}

	private async state(): Promise<ResourcesState> {
		const { skills, engines, diagnostics } = this.deps;
		const dumpPath = this.lastDump?.fsPath;
		const [index, allSkills, installedEngines, configs] = await Promise.all([
			skills.getIndex(dumpPath),
			skills.listAll(dumpPath),
			engines.list(),
			localConfigs(nvmStudioConfUri()),
		]);
		const context = index.context;
		const key = formatHierarchyPath(context);
		const setting = formatHierarchyPath(parseHierarchyPath(configuredSkillContext()) ?? []);
		const plan = this.catalog ? planInstall(this.catalog, context) : undefined;
		const diag = this.lastDump ? diagnostics.get(this.lastDump) : undefined;
		const activeDirs = new Set(index.skills.map(s => s.dir));
		const rows: ResourceRow[] = [];

		// Skills: one row per id; local copies from every root, remote from the server.
		const remoteSkills = new Map((this.catalog?.skills.skills ?? []).map(s => [s.id, s]));
		const off = disabledSkillNames();
		const localSkills = new Map<string, SkillMeta[]>();
		for (const m of allSkills) {
			localSkills.set(skillId(m), [...(localSkills.get(skillId(m)) ?? []), m]);
		}
		for (const id of new Set([...localSkills.keys(), ...remoteSkills.keys()])) {
			const locals = localSkills.get(id) ?? [];
			const remote = remoteSkills.get(id);
			const path = remote?.path ?? locals[0]?.hierarchy ?? [];
			const lv = installedSkillVersion(id);
			rows.push({
				kind: "skill",
				id,
				name: remote?.name ?? locals[0].name,
				group: formatHierarchyPath(path),
				description: remote?.description ?? locals[0]?.description ?? "",
				localVersion: locals.length ? lv : undefined,
				remoteVersion: remote?.version,
				local: locals.length > 0,
				remote: !!remote,
				status: statusOf(locals.length > 0, !!remote, lv, remote?.version),
				inContext: visibleIn(path, context),
				active: locals.some(m => activeDirs.has(m.dir)),
				scope: [...new Set(locals.map(m => m.scope))].join(", "),
				removable: locals.some(m => m.scope === "user"),
				enabled: locals.length ? !off.has(locals[0].name) && locals.some(m => m.enabled) : undefined,
				toggleable: locals.length ? locals.some(m => m.enabled) || off.has(locals[0].name) : undefined,
			});
		}

		// Layout descriptors under <home>/conf.
		const remoteConfigs = new Map((this.catalog?.configs ?? []).map(c => [c.path, c]));
		const plannedConfigs = new Set(plan?.configs.map(c => c.path));
		const usedDescriptors = new Set(diag?.descriptors.map(d => d.name.toLowerCase()));
		for (const id of new Set([...configs, ...remoteConfigs.keys()])) {
			const remote = remoteConfigs.get(id);
			const local = configs.includes(id);
			const parts = id.split("/");
			const name = parts[parts.length - 1];
			rows.push({
				kind: "config",
				id,
				name,
				group: parts.slice(0, -1).join("/"),
				description: [remote?.vendor, remote?.engines.length ? `engine ${remote.engines.join(", ")}` : "", remote?.skillContext ? `context ${remote.skillContext}` : ""]
					.filter(Boolean)
					.join(" · "),
				local,
				remote: !!remote,
				status: statusOf(local, !!remote),
				inContext: plannedConfigs.has(id) || (!!key && id.startsWith(`${key}/`)),
				active: usedDescriptors.has(name.toLowerCase()),
				removable: local,
			});
		}

		// Engine packs under <home>/engines.
		const remoteEngines = this.catalog?.engines.engines ?? [];
		const plannedEngines = new Set(plan?.engines.map(e => e.id));
		const seen = new Set<string>();
		for (const local of installedEngines) {
			const remote = remoteEngines.find(e => e.id === local.ref || (e.manifestId && e.manifestId === local.manifest.id));
			const id = remote?.id ?? local.ref;
			seen.add(id);
			rows.push({
				kind: "engine",
				id: local.ref,
				name: local.manifest.displayName ?? local.manifest.id,
				group: local.ref.split("/").slice(0, -1).join("/"),
				description: local.manifest.description ?? remote?.description ?? "",
				localVersion: local.manifest.version,
				remoteVersion: remote?.version,
				local: true,
				remote: !!remote,
				status: statusOf(true, !!remote, local.manifest.version, remote?.version),
				inContext: plannedEngines.has(id),
				removable: true,
			});
		}
		for (const remote of remoteEngines.filter(e => !seen.has(e.id))) {
			rows.push({
				kind: "engine",
				id: remote.id,
				name: remote.displayName,
				group: remote.path.slice(0, -1).join("/"),
				description: remote.description,
				remoteVersion: remote.version,
				local: false,
				remote: true,
				status: "available",
				inContext: plannedEngines.has(remote.id),
				removable: false,
			});
		}

		const nodes: ContextNode[] = contextCandidates(index.contexts, context).map(c => ({
			key: c.key,
			title: c.title.split(" › ").pop() ?? c.key,
			depth: c.path.length - 1,
			level: levelOf(c.path),
			local: c.local,
			remote: c.remote,
			recent: c.recent,
		}));
		const title = contextCandidates([], context).find(c => c.key === key)?.title ?? key;

		return {
			server: { base: this.base, status: this.status, error: this.serverError },
			context: { key, title, source: key === setting ? (key ? "setting" : "none") : "descriptor", nodes },
			rows,
			missing: plan?.missing ?? [],
			dump: diag && {
				fileName: diag.fileName,
				status: diag.status,
				blockCount: diag.blockCount,
				provider: diag.providerId,
				descriptors: diag.descriptors.map(d => `${d.name} (${d.via})`),
				missingSources: diag.sources.filter(s => !s.resolved).map(s => `${s.logical}: ${s.file}${s.required ? " (required)" : ""}`),
				engineIssue: diag.engineIssue,
				message: diag.message,
				activeSkills: index.skills.map(s => s.name).sort(),
			},
			trusted: vscode.workspace.isTrusted,
			enginesAllowed: vscode.workspace.getConfiguration("nvmstudio.nvm").get<boolean>("allowExternalEngines", false),
		};
	}

	private html(): string {
		const webview = this.panel.webview;
		const dist = vscode.Uri.joinPath(this.deps.context.extensionUri, "dist");
		const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "nvmResources.js"));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, "nvmResources.css"));
		const nonce = randomNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${style}">
	<title>NVM Resources</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
	}
}

export function registerResourcesPanel(deps: Deps): vscode.Disposable {
	return vscode.commands.registerCommand(OPEN_RESOURCES_COMMAND, () => ResourcesPanel.show(deps));
}
