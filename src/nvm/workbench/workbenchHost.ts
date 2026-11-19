// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Extension-host side of the NVM workbench: supplies the UI mode and persisted
 * layout state on open, handles the workbench's webview messages (layout
 * persistence, save-as, focus, ask-AI, whitelisted actions) and pushes
 * workbench commands to a dump's webview. `HexEditorProvider` only delegates.
 */

import * as vscode from "vscode";
import { WorkbenchAction, WorkbenchCommand, WorkbenchRequest } from "../../../shared/nvm/workbench/commands";
import { WorkbenchLayout, WorkbenchMode } from "../../../shared/nvm/workbench/layoutSchema";
import { WorkbenchInitState, WorkbenchPreset } from "../../../shared/nvm/workbench/presets";
import { EMPTY_INSIGHTS, NvmInsights } from "../../../shared/nvm/views/insights";
import { ExtensionHostMessageHandler, FromWebviewMessage, MessageType, ToWebviewMessage } from "../../../shared/protocol";
import { HexDocument } from "../../hexDocument";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { askNvm } from "../ai/openChat";
import { LayoutScope, WorkbenchLayoutStore } from "./layoutStore";
import { SceneLayoutFinder } from "./sceneLayouts";

const LAYOUT_MODE_SETTING = "nvmstudio.nvm.layoutMode";

/** Messages this host handles (everything else goes to the editor provider). */
const HANDLED = new Set<MessageType>([
	MessageType.WorkbenchStateChanged,
	MessageType.WorkbenchRequest,
	MessageType.NvmFocusChanged,
	MessageType.NvmAskAi,
	MessageType.GetNvmInsights,
]);

/** Supplies Overview insights (the AI capability facade, wired after construction). */
export type InsightsSource = () => Promise<NvmInsights>;

/** Whitelisted host commands a panel may trigger (never arbitrary command ids). */
const ACTION_COMMANDS: Record<WorkbenchAction, string> = {
	selectLayoutProfile: "nvmStudio.nvm.selectLayoutProfile",
	reloadLayout: "nvmStudio.nvm.reloadLayout",
	openReport: "nvmStudio.nvm.openReportPreview",
};

export class WorkbenchHost {
	private readonly store: WorkbenchLayoutStore;
	/** Scenario layouts found for each open dump (kept for later preset re-pushes). */
	private readonly scenes = new Map<string, WorkbenchLayout[]>();
	private insightsSource?: InsightsSource;

	constructor(
		context: vscode.ExtensionContext,
		private readonly registry: HexEditorRegistry,
		private readonly sceneFinder?: SceneLayoutFinder,
	) {
		this.store = new WorkbenchLayoutStore(context);
	}

	public layoutMode(): WorkbenchMode {
		return vscode.workspace.getConfiguration().get<WorkbenchMode>(LAYOUT_MODE_SETTING, "workbench") === "classic"
			? "classic"
			: "workbench";
	}

	public async initState(document: HexDocument): Promise<WorkbenchInitState> {
		const scenes = (await this.sceneFinder?.find(document.uri)) ?? [];
		this.scenes.set(document.uri.toString(), scenes);
		return this.store.initState(document.uri, scenes);
	}

	/** All presets for a dump (built-in, its scenario layouts, user layouts). */
	public presets(document = this.registry.activeDocument): WorkbenchPreset[] {
		return this.store.presets(document ? this.scenes.get(document.uri.toString()) : undefined);
	}

	/** The layout a preset currently shows (including the user's changes). */
	public effectiveLayout(preset: WorkbenchPreset): WorkbenchLayout {
		return this.store.effective(preset);
	}

	/** Late-bind the insights source (it depends on capabilities built after this host). */
	public setInsightsSource(source: InsightsSource): void {
		this.insightsSource = source;
	}

	/** Whether {@link handle} is responsible for this message. */
	public handles(message: FromWebviewMessage): boolean {
		return HANDLED.has(message.type);
	}

	/** Handle a workbench-related webview message (may return a reply). */
	public async handle(
		messaging: ExtensionHostMessageHandler,
		document: HexDocument,
		message: FromWebviewMessage,
	): Promise<ToWebviewMessage | undefined> {
		switch (message.type) {
			case MessageType.GetNvmInsights:
				return {
					type: MessageType.NvmInsightsResponse,
					insights: (await this.insightsSource?.().catch(() => undefined)) ?? EMPTY_INSIGHTS,
				};
			case MessageType.WorkbenchStateChanged:
				void this.store.setLastPreset(document.uri, message.presetId);
				if (message.override !== undefined) {
					void this.store.setOverride(message.presetId, message.override);
				}
				return undefined;
			case MessageType.WorkbenchRequest:
				void this.handleRequest(messaging, document, message.request);
				return undefined;
			case MessageType.NvmFocusChanged:
				this.registry.setNvmFocus(document, message.focus);
				return undefined;
			case MessageType.NvmAskAi:
				void askNvm(message.query);
				return undefined;
			default:
				return undefined;
		}
	}

	/** Push a workbench command to every webview of `document` (default: active dump). */
	public sendCommand(command: WorkbenchCommand, document = this.registry.activeDocument): boolean {
		if (!document) {
			return false;
		}
		let sent = false;
		for (const messaging of this.registry.getMessaging(document)) {
			messaging.sendEvent({ type: MessageType.WorkbenchCommand, command });
			sent = true;
		}
		return sent;
	}

	private async handleRequest(
		messaging: ExtensionHostMessageHandler,
		document: HexDocument,
		request: WorkbenchRequest,
	): Promise<void> {
		switch (request.kind) {
			case "setLocked":
				await this.store.setLocked(request.locked);
				return;
			case "resetAll":
				await this.store.clearOverrides();
				return;
			case "runAction":
				await vscode.commands.executeCommand(ACTION_COMMANDS[request.action]);
				return;
			case "saveAs": {
				const saved = await this.promptSaveAs(request.layout);
				if (saved) {
					messaging.sendEvent({
						type: MessageType.WorkbenchCommand,
						command: {
							kind: "setPresets",
							presets: this.presets(document),
							activate: saved,
						},
					});
				}
				return;
			}
		}
	}

	private async promptSaveAs(layout: WorkbenchLayout): Promise<string | undefined> {
		const name = await vscode.window.showInputBox({
			title: vscode.l10n.t("Save workbench layout"),
			prompt: vscode.l10n.t("Layout name (e.g. Reset investigation)"),
			validateInput: v => (v.trim() ? undefined : vscode.l10n.t("Enter a name")),
		});
		if (!name) {
			return undefined;
		}
		const scopes: (vscode.QuickPickItem & { scope: LayoutScope })[] = [
			{
				label: vscode.l10n.t("This workspace"),
				description: vscode.l10n.t("Available for dumps in this workspace"),
				scope: "workspace",
			},
			{
				label: vscode.l10n.t("Personal"),
				description: vscode.l10n.t("Available in every workspace"),
				scope: "personal",
			},
		];
		const pick = await vscode.window.showQuickPick(scopes, { title: vscode.l10n.t("Save layout for…") });
		if (!pick) {
			return undefined;
		}
		return this.store.addUserLayout(layout, name.trim(), pick.scope);
	}
}
