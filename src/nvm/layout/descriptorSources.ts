// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Where a layout descriptor was loaded from, so a declared source written as a
 * relative path (`"./x.json"`, `"../../vector/dem/pack.nvmstructs.json"`) is
 * resolved against the DESCRIPTOR's folder instead of being searched near the
 * dump. This lets a descriptor reference shared files that are installed next
 * to it (e.g. a reusable struct pack) with no extra setting. Bare file names
 * (`"Dem_Lcfg.h"`) keep the existing near-dump / workspace-root search.
 *
 * Vendor-blind: the core never interprets the file, it only locates it.
 */

import type { LayoutConfig } from "./provider";

const dirs = new WeakMap<LayoutConfig, string>();

/** Record the folder (fsPath) a descriptor object was read from. */
export function rememberDescriptorDir(config: LayoutConfig, dir: string): void {
	dirs.set(config, dir);
}

/** The folder a descriptor was read from, when known. */
export function descriptorDirOf(config: LayoutConfig): string | undefined {
	return dirs.get(config);
}

/** True for a source path that is relative to its descriptor (`./…` or `../…`). */
export function isDescriptorRelative(file: string): boolean {
	return /^\.\.?[\\/]/.test(file);
}
