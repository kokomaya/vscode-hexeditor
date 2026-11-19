// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Receives host → workbench commands. Registered eagerly at module load (like
 * the NVM blocks handler) and buffered until the workbench is ready, so a
 * command sent right after open (e.g. by the AI) is never lost.
 */

import { WorkbenchCommand } from "../../../shared/nvm/workbench/commands";
import { MessageType } from "../../../shared/protocol";
import { registerHandler } from "../state";

type Listener = (command: WorkbenchCommand) => void;

let listener: Listener | undefined;
const pending: WorkbenchCommand[] = [];

registerHandler(MessageType.WorkbenchCommand, msg => {
	if (listener) {
		listener(msg.command);
	} else {
		pending.push(msg.command);
	}
});

/** Attach the (single) workbench command listener; flushes buffered commands. */
export function onWorkbenchCommand(l: Listener): () => void {
	listener = l;
	for (const command of pending.splice(0)) {
		l(command);
	}
	return () => {
		if (listener === l) {
			listener = undefined;
		}
	};
}
