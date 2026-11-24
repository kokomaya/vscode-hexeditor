// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Automatic block → struct binding through the AUTOSAR RAM mirror.
 *
 * Every NvM block with a permanent RAM block names it in `NvM_Cfg.c`
 * (`NvMRamBlockDataAddress = &Dem_Cfg_StatusData`), and the generated module
 * headers declare that variable with its type
 * (`extern VAR(Dem_Cfg_StatusDataType, DEM_NVM_DATA_NOINIT) Dem_Cfg_StatusData;`).
 * Chaining the two gives each block its business struct with zero
 * configuration — the type comes from the same build as the dump.
 *
 * Engine-side on purpose: binding a block to a layout is server knowledge;
 * the plugin only runs the engine.
 */

import { NvmCfgBlock } from "./nvmCfg";

/** Strip C comments so a commented-out declaration is not picked up. */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Map scalar (non-array) variable declarations to their type name:
 * `[extern] [static] [volatile] VAR(Type, Class) name;` and
 * `[extern] [const|volatile] Type name;`. Array variables are skipped — their
 * element type is not a block-level struct.
 */
export function parseVariableTypes(source: string): Map<string, string> {
	const out = new Map<string, string>();
	const text = stripComments(source);
	const qualifiers = String.raw`(?:(?:extern|static|volatile|const)\s+)*`;
	const autosar = new RegExp(
		String.raw`(?:^|[;{}\n])\s*${qualifiers}(?:VAR|CONST)\s*\(\s*(?:volatile\s+)?([A-Za-z_]\w*)\s*,[^()]*\)\s+([A-Za-z_]\w*)\s*;`,
		"g",
	);
	const plain = new RegExp(
		String.raw`(?:^|[;{}\n])\s*extern\s+(?:(?:const|volatile)\s+)*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;`,
		"g",
	);
	for (const re of [autosar, plain]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			if (!out.has(m[2])) {
				out.set(m[2], m[1]);
			}
		}
	}
	return out;
}

/** One automatic binding, with the chain that produced it (for diagnostics). */
export interface RamMirrorBinding {
	struct: string;
	ramVariable: string;
}

/**
 * Bind every NvM block whose RAM mirror variable is declared with a struct
 * type present in `structNames`. Blocks without a RAM block (`NULL_PTR`),
 * with an undeclared variable, or with a primitive/unknown type are skipped.
 */
export function ramMirrorBindings(
	nvmBlocks: Iterable<NvmCfgBlock>,
	variableTypes: Map<string, string>,
	structNames: Set<string>,
): Map<string, RamMirrorBinding> {
	const out = new Map<string, RamMirrorBinding>();
	for (const b of nvmBlocks) {
		const type = b.ramVariable ? variableTypes.get(b.ramVariable) : undefined;
		if (b.ramVariable && type && structNames.has(type)) {
			out.set(b.name, { struct: type, ramVariable: b.ramVariable });
		}
	}
	return out;
}
