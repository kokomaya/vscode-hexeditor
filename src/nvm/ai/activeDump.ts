// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Read-only access to the active dump for the AI facades (SRP: one place that
 * knows how to find the active document, its blocks and a block by name).
 */

import { NvmBlockInfo } from "../../../shared/protocol";
import { HexDocument } from "../../hexDocument";
import { HexEditorRegistry } from "../../hexEditorRegistry";
import { NvmCapabilityError } from "./capabilityTypes";

export class ActiveDump {
	constructor(private readonly registry: HexEditorRegistry) {}

	/** The active dump document, or throw a friendly error. */
	public doc(): HexDocument {
		const doc = this.registry.activeDocument;
		if (!doc) {
			throw new NvmCapabilityError("No active NVM dump. Open a dump in the hex editor first.");
		}
		return doc;
	}

	public blocks(): NvmBlockInfo[] {
		return this.registry.getNvmBlocks(this.doc()) as NvmBlockInfo[];
	}

	/** Exact (case-insensitive) name match first, then substring. */
	public find(name: string): NvmBlockInfo | undefined {
		const blocks = this.blocks();
		const q = (name ?? "").toLowerCase();
		return (
			blocks.find(b => (b.name ?? b.id).toLowerCase() === q) ??
			blocks.find(b => b.id.toLowerCase() === q) ??
			blocks.find(b => (b.name ?? b.id).toLowerCase().includes(q))
		);
	}

	/** Like {@link find} but throws when absent. */
	public require(name: string): NvmBlockInfo {
		const b = this.find(name);
		if (!b) {
			throw new NvmCapabilityError(`No block matching "${name}".`);
		}
		return b;
	}
}
