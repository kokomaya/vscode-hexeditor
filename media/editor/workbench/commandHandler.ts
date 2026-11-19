// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Executes host/AI workbench commands against the controller + preset
 * session. Every untrusted payload is sanitized/validated here, and a layout
 * that can't be shown never replaces the current one.
 */

import { sanitizeTableQuery } from "../../../shared/nvm/views/tableQuery";
import { WorkbenchCommand } from "../../../shared/nvm/workbench/commands";
import { normalizeLayout } from "../../../shared/nvm/workbench/layoutNormalize";
import { validateLayout } from "../../../shared/nvm/workbench/layoutSchema";
import { WorkbenchViewIds } from "../../../shared/nvm/workbench/viewIds";
import { PresetSession } from "./presetSession";
import { viewRegistry } from "./registry";
import { WorkbenchController } from "./workbenchController";

export interface CommandContext {
	controller: WorkbenchController;
	session: PresetSession;
	/** Re-render the session's active layout. */
	applyActive(): void;
}

export function handleWorkbenchCommand(command: WorkbenchCommand, ctx: CommandContext): void {
	switch (command.kind) {
		case "showView":
			ctx.controller.showView(command.view, command.params);
			return;
		case "filterTable": {
			const q = sanitizeTableQuery(command.query);
			// Replace the whole query (explicit undefined clears previous values).
			ctx.controller.showView(WorkbenchViewIds.blocksTable, {
				search: q.search,
				sort: q.sort,
				columns: q.columns,
				latestOnly: q.latestOnly,
			});
			return;
		}
		case "applyLayout": {
			const result = validateLayout(command.layout);
			if (!result.ok) {
				console.warn("Ignoring invalid workbench layout:", result.error);
				return;
			}
			const normalized = normalizeLayout(result.layout, { isAvailable: v => viewRegistry.has(v) });
			if (normalized && ctx.controller.apply(normalized)) {
				// Persist as the active preset's override so it survives reopen and can be reset.
				ctx.session.userChanged(normalized);
			}
			return;
		}
		case "selectPreset":
			if (ctx.session.select(command.presetId)) {
				ctx.applyActive();
			}
			return;
		case "resetLayout":
			ctx.session.reset();
			ctx.applyActive();
			return;
		case "setPresets":
			ctx.session.setPresets(command.presets, command.activate);
			if (command.activate) {
				ctx.applyActive();
			}
			return;
	}
}
