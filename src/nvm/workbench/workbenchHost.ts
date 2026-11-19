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
import { WorkbenchInitState } from "../../../shared/nvm/workbench/presets";
import { ExtensionHostMessageHandler, FromWebviewMessage, MessageType } from "../../../shared/protocol";
import { HexDocument } from "../../hexDocument";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { askNvm } from "../ai/openChat";
import { LayoutScope, WorkbenchLayoutStore } from "./layoutStore";

const LAYOUT_MODE_SETTING = "nvmstudio.nvm.layoutMode";

/** Whitelisted host commands a panel may trigger (never arbitrary command ids). */
const ACTION_COMMANDS: Record<WorkbenchAction, string> = {
	selectLayoutProfile: "nvmStudio.nvm.selectLayoutProfile",
	reloadLayout: "nvmStudio.nvm.reloadLayout",
	openReport: "nvmStudio.nvm.openReportPreview",
};

export class WorkbenchHost {
	private readonly store: WorkbenchLayoutStore;

	constructor(
		context: vscode.ExtensionContext,
		private readonly registry: HexEditorRegistry,
	) {
		this.store = new WorkbenchLayoutStore(context);
	}

	public layoutMode(): WorkbenchMode {
		return vscode.workspace.getConfiguration().get<WorkbenchMode>(LAYOUT_MODE_SETTING, "workbench") === "classic"
			? "classic"
			: "workbench";
	}

	public initState(document: HexDocument): WorkbenchInitState {
		return this.store.initState(document.uri);
	}

	/** Handle a workbench-related webview message. Returns true if it was one. */
	public handleMessage(
		messaging: ExtensionHostMessageHandler,
		document: HexDocument,
		message: FromWebviewMessage,
	): boolean {
		switch (message.type) {
			case MessageType.WorkbenchStateChanged:
				void this.store.setLastPreset(document.uri, message.presetId);
				if (message.override !== undefined) {
					void this.store.setOverride(message.presetId, message.override);
				}
				return true;
			case MessageType.WorkbenchRequest:
				void this.handleRequest(messaging, message.request);
				return true;
			case MessageType.NvmFocusChanged:
				this.registry.setNvmFocus(document, message.focus);
				return true;
			case MessageType.NvmAskAi:
				void askNvm(message.query);
				return true;
			default:
				return false;
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

	private async handleRequest(messaging: ExtensionHostMessageHandler, request: WorkbenchRequest): Promise<void> {
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
						command: { kind: "setPresets", presets: this.store.presets(), activate: saved },
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
