// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Vendor-neutral block metadata for the structured (T1) tier, derived only
 * from the generic {@link NvmModel}: logical identity, write order (file order
 * of a sequential log), whether an instance is the newest one, and generic
 * attribute columns (id / status / CRC / version). This is what lets the
 * Blocks table, tree, overview and AI timeline work for any declarative format.
 */

import { NvmBlockInstance, NvmModel } from "../../../shared/nvm";
import { NvmAttribute, NvmIdentityRef } from "../../../shared/protocol";

export interface InstanceMetadata {
	identity: NvmIdentityRef;
	sequence: number;
	isLatest: boolean;
	attributes: NvmAttribute[];
}

const idText = (id: number | string) => (typeof id === "number" ? `0x${id.toString(16).toUpperCase()}` : id);

const crcText = (instance: NvmBlockInstance) =>
	instance.crc.valid === undefined ? "n/a" : instance.crc.valid ? "ok" : "mismatch";

/**
 * The newest usable instance per logical id: in a sequential log later
 * instances supersede earlier ones; an instance that failed its CRC is only
 * chosen when no valid one exists.
 */
function latestInstances(instances: readonly NvmBlockInstance[]): Set<NvmBlockInstance> {
	const byId = new Map<string, NvmBlockInstance>();
	for (const instance of instances) {
		const key = String(instance.logicalId);
		const prev = byId.get(key);
		if (!prev || instance.status === "valid" || prev.status !== "valid") {
			byId.set(key, instance);
		}
	}
	return new Set(byId.values());
}

/** Metadata per instance (same order as `model.allInstances`). */
export function structuredMetadata(model: NvmModel, vendor: string): InstanceMetadata[] {
	const active = latestInstances(model.allInstances);
	return model.allInstances.map((instance, index) => {
		const attributes: NvmAttribute[] = [
			{ key: "blockId", label: "Block ID", value: idText(instance.logicalId), kind: "id" },
			{ key: "status", label: "Status", value: instance.status, kind: "status" },
			{ key: "crc", label: "CRC", value: crcText(instance), kind: "crc" },
		];
		if (instance.version !== undefined) {
			attributes.push({ key: "version", label: "Version", value: instance.version, kind: "counter" });
		}
		return {
			identity: { key: `${vendor}:${String(instance.logicalId)}`, label: `${vendor} block ${instance.logicalId}` },
			sequence: index,
			isLatest: active.has(instance),
			attributes,
		};
	});
}
