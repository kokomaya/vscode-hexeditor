// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Typed webview → host calls used by the workbench and its panels. Keeps the
 * raw message plumbing out of UI components.
 */

import { MessageType } from "../../../shared/protocol";
import { WorkbenchAction, WorkbenchRequest } from "../../../shared/nvm/workbench/commands";
import { WorkbenchLayout } from "../../../shared/nvm/workbench/layoutSchema";
import { messageHandler } from "../state";
import { HostLink } from "./presetSession";

/** Open the chat with a pre-filled (not sent) @nvm question. */
export const askAi = (query: string): void =>
	messageHandler.sendEvent({ type: MessageType.NvmAskAi, query });

/** Run one of the whitelisted host actions. */
export const runHostAction = (action: WorkbenchAction): void =>
	messageHandler.sendEvent({ type: MessageType.WorkbenchRequest, request: { kind: "runAction", action } });

/** The {@link HostLink} the preset session persists through. */
export const presetHostLink: HostLink = {
	stateChanged(presetId: string, override?: WorkbenchLayout | null) {
		messageHandler.sendEvent({ type: MessageType.WorkbenchStateChanged, presetId, override });
	},
	request(request: WorkbenchRequest) {
		messageHandler.sendEvent({ type: MessageType.WorkbenchRequest, request });
	},
};
