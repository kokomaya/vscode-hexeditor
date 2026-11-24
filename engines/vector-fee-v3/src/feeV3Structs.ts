// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Business-struct binding + decoding for the Vector FEE V3 engine.
 *
 * This is where the engine — NOT the plugin core — decides how to turn a bound
 * block's payload into a decoded value tree. It:
 *
 * 1. builds a struct/enum catalog from the sources the descriptor declared
 *    (generated C headers, ARXML, or inline JSON), via the injected SDK, and
 * 2. resolves each block↔struct binding (by name / glob / tag / identity) and
 *    decodes the matched block's business payload.
 *
 * Everything vendor-specific about "which block means what" lives in config
 * here; the SDK primitives it calls are generic. Requires SDK v3
 * (`sdk.decodeStructRich`); on an older SDK this module is a no-op.
 */

import { NvmCfgBlock } from "./nvmCfg";
import { parseVariableTypes, RamMirrorBinding, ramMirrorBindings } from "./ramMirror";
import { EngineSdk, NvmDecodedNode, NvmStructCatalog } from "./types";

/** One block↔struct binding from `options.blockStructs`. */
export interface BlockStructBinding {
	match: {
		/** Exact block name (as resolved from Fee_Lcfg / the tag fallback). */
		name?: string;
		/** Case-insensitive `*` glob on the block name. */
		nameGlob?: string;
		/** FEE block tag (== Fee_Lcfg BlkIdx). */
		tag?: number;
		/** Logical identity key, e.g. "tag:0x31". */
		identity?: string;
	};
	/** Struct name to decode the payload with (must exist in the catalog). */
	struct: string;
	/** Optional cap on decoded nodes for this binding. */
	maxNodes?: number;
}

/**
 * Build an enum from a `#define <prefix><NAME> <int>` table in a declared source.
 * e.g. `{ enum: "DemEventName", source: "demLcfg", prefix:
 * "DemConf_DemEventParameter_" }` turns the AUTOSAR DEM event-id list into a
 * value→name enum a decoded field can bind to (`compu.enum` / `format.enum`).
 */
export interface DefineEnumSpec {
	/** Catalog enum name to create/populate. */
	enum: string;
	/** Logical source name (declared in `sources`) to scrape. */
	source: string;
	/** The `#define` name prefix to require and strip. */
	prefix: string;
	/** Byte width of a field whose type IS this enum (default 4). */
	width?: number;
}

/** Struct-decoding configuration carried in the descriptor `options`. */
export interface FeeV3StructOptions {
	/** Inline struct + enum catalog (JSON). */
	structCatalog?: unknown;
	/**
	 * `fromSources`: logical source names (declared in `sources`) to parse into the
	 * catalog. `packs`: logical source names whose content is a JSON
	 * {@link StructPack} — reusable semantics (formats, enums, bindings) shared by
	 * every project using the same BSW module, so a project descriptor only lists
	 * its sources instead of re-declaring them.
	 */
	structs?: {
		fromSources?: string[];
		packs?: string[];
		/**
		 * Bind blocks automatically through their NvM RAM mirror (`NvM_Cfg.c`
		 * `NvMRamBlockDataAddress` → the variable's declared struct type in the
		 * `fromSources` headers). Default `true`; explicit `blockStructs` (the
		 * descriptor's, then the packs') always win. Needs the `nvmCfg` source.
		 */
		autoBind?: boolean;
	};
	/**
	 * Enums scraped from `#define <prefix><NAME> <int>` tables in declared sources
	 * (e.g. the AUTOSAR DEM event-id list). Merged into the catalog like any enum.
	 */
	enumsFromDefines?: DefineEnumSpec[];
	/** Block↔struct bindings; the engine's decision on business meaning. */
	blockStructs?: BlockStructBinding[];
	/**
	 * Also decode historical (stale) copies of bound blocks, not just the current
	 * version. Defaults to `false` — decoding only the latest keeps the payload
	 * lean. Set `true` for history analysis (compare a block across its versions).
	 */
	decodeStale?: boolean;
}

/**
 * A reusable struct pack (`*.nvmstructs.json`), referenced through a declared
 * source and listed in `options.structs.packs`. It carries only SEMANTICS:
 * byte layout always comes from the project's own headers, so a pack written
 * once fits every project whatever its array sizes (e.g. the event count).
 */
export interface StructPack {
	/** Overlay patches (by field name) + gap-fill enums. */
	structs?: Record<string, unknown>;
	enums?: Record<string, unknown>;
	/** Bindings used when the descriptor itself has no matching binding. */
	blockStructs?: BlockStructBinding[];
	/** Define-table enums; `source` names a logical source the descriptor declares. */
	enumsFromDefines?: DefineEnumSpec[];
}

/** Compiled matcher + catalog, or `undefined` when nothing is configured. */
export interface FeeV3StructResolver {
	catalog: NvmStructCatalog;
	bindings: BlockStructBinding[];
	/** Automatic bindings by block name (RAM mirror), used when no explicit binding matches. */
	autoBindings: Map<string, RamMirrorBinding>;
	/** Memoized C `sizeof` per struct (see {@link structSize}). */
	sizes: Map<string, number | undefined>;
	sdk: EngineSdk;
	/** When false, only current (non-stale) bound blocks are decoded. */
	decodeStale: boolean;
}

/** Turn a `*` glob into a case-insensitive anchored RegExp. */
function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

/** Detect an ARXML/XML source by a cheap content sniff. */
function looksLikeXml(content: string): boolean {
	const head = content.slice(0, 512);
	return head.includes("<AUTOSAR") || head.includes("<?xml") || head.includes("<ARXML");
}

/**
 * Build a resolver from the struct options + the declared sources. Returns
 * `undefined` when struct decoding is not configured or the SDK is too old.
 */
export function buildStructResolver(
	sdk: EngineSdk,
	sources: Record<string, string>,
	options: FeeV3StructOptions,
	nvmBlocks?: Map<string, NvmCfgBlock>,
): FeeV3StructResolver | undefined {
	const packs = loadPacks(sources, options.structs?.packs ?? []);
	// Descriptor bindings first so a project can override what a pack binds.
	const bindings = [
		...(options.blockStructs ?? []),
		...packs.flatMap(p => p.blockStructs ?? []),
	].filter(b => b && b.match && typeof b.struct === "string");
	const autoBind = options.structs?.autoBind !== false && !!nvmBlocks && nvmBlocks.size > 0;
	if (bindings.length === 0 && !autoBind) {
		return undefined;
	}
	// Requires the v3 struct-decoding surface.
	if (
		typeof sdk.version !== "number" ||
		sdk.version < 3 ||
		typeof sdk.decodeStructRich !== "function" ||
		typeof sdk.mergeCatalogs !== "function"
	) {
		return undefined;
	}

	const parts: NvmStructCatalog[] = [];
	// Inline JSON catalog first (lowest precedence — later parts fill/override).
	if (options.structCatalog && typeof sdk.parseStructCatalog === "function") {
		parts.push(sdk.parseStructCatalog(options.structCatalog));
	}
	// C headers are CONCATENATED and parsed together so #define / typedef / enum
	// definitions in one header resolve references in another (e.g. the size
	// macros in FS_SafeSection_Prv.h feed the arrays in FS_SafeSection_Types.h).
	// ARXML sources are parsed individually.
	const fromSources = options.structs?.fromSources ?? [];
	const cHeaders: string[] = [];
	for (const logical of fromSources) {
		const content = sources[logical];
		if (!content) {
			continue;
		}
		if (looksLikeXml(content)) {
			if (typeof sdk.arxmlStructs === "function") {
				parts.push(sdk.arxmlStructs(content));
			}
		} else {
			cHeaders.push(content);
		}
	}
	if (cHeaders.length) {
		const merged = cHeaders.join("\n");
		if (typeof sdk.parseCStructsEx === "function") {
			const { catalog, diagnostics } = sdk.parseCStructsEx(merged);
			parts.push(catalog);
			if (diagnostics.length && typeof console !== "undefined") {
				// Surface unresolved macros / types so the user can supply them as
				// inline JSON. Cap to avoid flooding the console.
				console.warn(
					`[vector-fee-v3] struct source diagnostics (${diagnostics.length}); first few:`,
					diagnostics.slice(0, 8),
				);
			}
		} else if (typeof sdk.parseCStructs === "function") {
			parts.push(sdk.parseCStructs(merged));
		}
	}

	// Enums scraped from `#define <prefix><NAME> <int>` tables (e.g. the DEM
	// event-id list). Added as catalog enums so a decoded field can label its
	// value; still overridable by the inline JSON overlay below.
	const defineSpecs = [
		...(options.enumsFromDefines ?? []),
		...packs.flatMap(p => p.enumsFromDefines ?? []),
	];
	if (defineSpecs.length && typeof sdk.parseDefineEnum === "function") {
		const enums: Record<string, unknown> = {};
		for (const spec of defineSpecs) {
			if (!spec || !spec.enum || !spec.source || !spec.prefix) {
				continue;
			}
			const content = sources[spec.source];
			if (!content) {
				continue;
			}
			const { values } = sdk.parseDefineEnum(content, spec.prefix);
			if (Object.keys(values).length > 0) {
				enums[spec.enum] = { name: spec.enum, values, width: spec.width ?? 4 };
			}
		}
		if (Object.keys(enums).length > 0) {
			parts.push({ structs: {}, enums } as NvmStructCatalog);
		}
	}

	// Overlays patch the parsed catalog in order: packs (shared semantics) first,
	// then the descriptor's inline JSON LAST, so explicit project overrides
	// (union discriminators, format bindings, gap-fill enums) win over both.
	const overlays: NvmStructCatalog[] = [];
	if (typeof sdk.parseStructCatalog === "function") {
		for (const pack of packs) {
			overlays.push(sdk.parseStructCatalog({ structs: pack.structs ?? {}, enums: pack.enums ?? {} }));
		}
		if (options.structCatalog) {
			overlays.push(sdk.parseStructCatalog(options.structCatalog));
		}
	}
	let catalog = sdk.mergeCatalogs(...parts);
	for (const overlay of overlays) {
		catalog = mergeCatalogsDeep(sdk, catalog, overlay);
	}

	// Zero-config bindings: NvM RAM mirror variable → its declared struct type.
	const autoBindings =
		autoBind && nvmBlocks
			? ramMirrorBindings(
					nvmBlocks.values(),
					parseVariableTypes(cHeaders.join("\n")),
					new Set(Object.keys(catalog.structs)),
				)
			: new Map<string, RamMirrorBinding>();
	if (bindings.length === 0 && autoBindings.size === 0) {
		return undefined;
	}
	return {
		catalog,
		bindings,
		autoBindings,
		sizes: new Map(),
		sdk,
		decodeStale: options.decodeStale === true,
	};
}

/** Parse the declared pack sources; a missing or malformed pack is skipped with a warning. */
function loadPacks(sources: Record<string, string>, logicalNames: string[]): StructPack[] {
	const out: StructPack[] = [];
	for (const logical of logicalNames) {
		const content = sources[logical];
		if (!content) {
			console.warn(`[vector-fee-v3] struct pack "${logical}" is not available (source not found).`);
			continue;
		}
		try {
			const pack = JSON.parse(content) as StructPack;
			if (pack && typeof pack === "object") {
				out.push(pack);
			}
		} catch (e) {
			console.warn(`[vector-fee-v3] struct pack "${logical}" is not valid JSON:`, e);
		}
	}
	return out;
}

/**
 * Deep-merge the inline JSON overlay onto the parsed catalog: parsed structs are
 * the base (full field layout from C), and the overlay patches individual struct
 * fields by name (to attach `format` / `discriminator` / `cases` without
 * re-listing every field) and adds/overrides enums. A struct present ONLY in the
 * overlay is added whole.
 */
function mergeCatalogsDeep(
	sdk: EngineSdk,
	base: NvmStructCatalog,
	overlay: NvmStructCatalog,
): NvmStructCatalog {
	const out: NvmStructCatalog = {
		structs: { ...base.structs },
		enums: { ...base.enums, ...overlay.enums },
	};
	for (const [name, ov] of Object.entries(overlay.structs)) {
		const existing = out.structs[name];
		if (!existing) {
			// A struct only the overlay knows is added whole when it is a real
			// definition. A pure patch (formats only) for a struct this project's
			// headers do not have is dropped — it must never decode as fake u8s.
			const ovFieldList = (ov as { fields?: { name: string }[] }).fields ?? [];
			if (ovFieldList.every(isFieldDefinition)) {
				out.structs[name] = ov as never;
			}
			continue;
		}
		// Patch fields by name; append overlay-only fields that are real definitions.
		const merged = { ...(existing as Record<string, unknown>) } as {
			fields: { name: string }[];
		} & Record<string, unknown>;
		const fields = [...((existing as { fields: { name: string }[] }).fields ?? [])];
		const ovFields = (ov as { fields?: { name: string }[] }).fields ?? [];
		for (const of of ovFields) {
			const idx = fields.findIndex(f => f.name === of.name);
			if (idx >= 0) {
				const patched: Record<string, unknown> = { ...fields[idx], ...of };
				// `type` and `struct` are mutually exclusive: an overlay giving one
				// replaces the other (e.g. resolve an opaque typedef to "u32").
				if ("type" in of) {
					delete patched.struct;
				} else if ("struct" in of) {
					delete patched.type;
				}
				fields[idx] = patched as { name: string };
			} else if (isFieldDefinition(of)) {
				fields.push(of);
			}
			// else: a patch for a field this project's config compiled out
			// (e.g. a `STD_OFF` member) — ignored so shared packs stay safe.
		}
		merged.fields = fields;
		// Copy struct-level overlay keys (layout/union/endian) if present.
		for (const k of ["layout", "union", "endian"] as const) {
			if ((ov as Record<string, unknown>)[k] !== undefined) {
				merged[k] = (ov as Record<string, unknown>)[k];
			}
		}
		out.structs[name] = merged as never;
	}
	return out;
}

/** True when an overlay field carries its own layout (`type` or `struct`), not just a patch. */
function isFieldDefinition(field: { name: string }): boolean {
	const f = field as { type?: unknown; struct?: unknown };
	return typeof f.type === "string" || typeof f.struct === "string";
}

/** The block facts a binding can match against. */
export interface BlockMatchInfo {
	name: string;
	tag: number;
	identityKey: string;
}

/**
 * Find the binding for a block: the first matching explicit binding, else the
 * automatic RAM-mirror binding, else `undefined`.
 */
export function matchBinding(
	resolver: FeeV3StructResolver,
	info: BlockMatchInfo,
): BlockStructBinding | undefined {
	const explicit = matchExplicit(resolver, info);
	if (explicit) {
		return explicit;
	}
	const auto = resolver.autoBindings.get(info.name);
	return auto ? { match: { name: info.name }, struct: auto.struct } : undefined;
}

function matchExplicit(
	resolver: FeeV3StructResolver,
	info: BlockMatchInfo,
): BlockStructBinding | undefined {
	for (const b of resolver.bindings) {
		const m = b.match;
		if (m.tag !== undefined && m.tag === info.tag) {
			return b;
		}
		if (m.name !== undefined && m.name === info.name) {
			return b;
		}
		if (m.identity !== undefined && m.identity === info.identityKey) {
			return b;
		}
		if (m.nameGlob !== undefined && globToRegExp(m.nameGlob).test(info.name)) {
			return b;
		}
	}
	return undefined;
}

/**
 * C `sizeof(struct)` including tail padding, measured with the SDK decoder as
 * the stride of a 2-element array (element 1 starts at `sizeof`). Memoized;
 * `undefined` when it cannot be measured.
 */
export function structSize(resolver: FeeV3StructResolver, name: string): number | undefined {
	if (resolver.sizes.has(name)) {
		return resolver.sizes.get(name);
	}
	let size: number | undefined;
	const def = resolver.catalog.structs[name];
	if (def) {
		const probe = {
			name: "__sizeof__",
			layout: (def as { layout?: string }).layout,
			fields: [{ name: "x", struct: name, dims: [2] }],
		};
		const [arr] = resolver.sdk.decodeStructRich!(new Uint8Array(0), probe as never, {
			baseOffset: 0,
			catalog: resolver.catalog,
			maxNodes: 1_000_000,
		});
		const second = arr?.children?.[1];
		size = second && second.offset > 0 ? second.offset : undefined;
	}
	resolver.sizes.set(name, size);
	return size;
}

/**
 * Decode a bound block's payload into a value tree. `payloadBytes` is the flat
 * image slice `[payloadOffset, payloadOffset+netLength)`; `baseOffset` is the
 * absolute editor offset of that slice's first byte. `expectedSize` is the
 * configured business length (`NvMNvBlockLength`): when the struct's `sizeof`
 * differs, a warning note is prepended — the headers do not match the build
 * that wrote this dump. Returns `undefined` when decoding produces nothing.
 */
export function decodeBoundBlock(
	resolver: FeeV3StructResolver,
	binding: BlockStructBinding,
	payloadBytes: Uint8Array,
	baseOffset: number,
	expectedSize?: number,
): NvmDecodedNode[] | undefined {
	const def = resolver.catalog.structs[binding.struct];
	if (!def) {
		return [
			{
				name: binding.struct,
				type: "note",
				offset: baseOffset,
				length: 0,
				value: `<struct "${binding.struct}" not found in catalog>`,
			},
		];
	}
	const nodes = resolver.sdk.decodeStructRich!(payloadBytes, def, {
		baseOffset,
		catalog: resolver.catalog,
		maxNodes: binding.maxNodes,
	});
	const size = expectedSize !== undefined ? structSize(resolver, binding.struct) : undefined;
	if (size !== undefined && expectedSize !== undefined && size !== expectedSize) {
		nodes.unshift({
			name: "⚠ size mismatch",
			type: "note",
			offset: baseOffset,
			length: 0,
			value:
				`sizeof(${binding.struct}) = ${size} but NvMNvBlockLength = ${expectedSize}: ` +
				"the struct headers do not match the build that wrote this dump.",
		});
	}
	return nodes.length ? nodes : undefined;
}
