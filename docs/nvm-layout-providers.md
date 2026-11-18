# NVM layout providers & configuration

How to make the hex editor colour an NVM dump. **Everything is config-driven** — no
vendor format is applied automatically. The editor only renders when a
`*.nvmlayout.json` descriptor opts in, either by describing blocks directly or by
selecting a code *engine* (e.g. the Vector link-table parser). Companion to
[nvm-context.md](nvm-context.md) §10.

---

## 1. Architecture (no vendor is a special case)

The pipeline is layered and uniform for every vendor. The core speaks only in
**capabilities** (`image` / `symbols` / `layout` / `struct` / `annotations`) and never names
a file format or a vendor — adapters carry all that knowledge. See
[nvm-capabilities.md](nvm-capabilities.md).

```
raw dump ──(image adapter)──▶ ImageData ┐
config/arxml ─(symbol adapter)▶ SymbolTable ├─▶ layout provider ─▶ NvmBlockInfo[] ─▶ display
*.nvmlayout.json descriptors ──────────────┘
```

- **image capability** (`ImageProvider`, e.g. `srecordImage.ts`): decode the raw dump into an
  `ImageData` (bytes + base address). The core resolves this **once** and hands it to every
  layout provider — providers never re-parse the container.
- **symbols capability** (`SymbolProvider`, e.g. `arxmlSymbols.ts`): emit a vendor-blind
  `SymbolTable` (`id → { name, length }`) from whatever is available (AUTOSAR config today;
  source/map/debug files can register their own adapter). Resolved **lazily** and used to give
  layout blocks their business names when a block's logical id matches.
- **layout capability** (`NvmLayoutProvider` in `src/nvm/layout/`): `detect(ctx)` decides if it
  applies, `parse(ctx)` returns `NvmBlockInfo[]` from the vendor-blind `ResolveContext`
  (`ctx.image`, `ctx.configs`, `ctx.sources`, `ctx.symbols()`). Descriptors pick the lowest
  **tier** that fits (an optional `strategy` names it; otherwise it is inferred):
  - **T0 `positional`** — the **config adapter**: static `blocks` with fixed offsets/lengths,
    no code.
  - **T1 `structured`** — the **structured adapter**: a declarative `profile`
    (header + payload-length + CRC + iteration); the core walks the image itself, no code and
    no hand-listed blocks.
  - **T2 `engine`** — an **engine adapter** (e.g. the Vector link-table walk): arbitrary JS
    for algorithmic formats a schema cannot express.

  All three are registered the same way and are inert until a descriptor opts in — **Vector
  is one adapter among equals, not a built-in format**.
- **unified model** (`NvmBlockInfo[]`): blocks + coloured field attributes. The single
  contract the display consumes.
- **display**: the webview colouring + data inspector.

Adding a vendor = a declarative `*.nvmlayout.json` (simple layouts) **or** a new adapter file
+ `registerLayoutProvider` (algorithmic layouts). Nothing is privileged.

---

## 2. How it runs (on open)

When you open a file, `src/hexEditorProvider.ts` → `tryLoadNvmBlocks()`:

1. Only runs for S-record / Intel HEX text: `.mot .srec .s19 .s28 .s37 .s1 .s2 .s3
   .hex .ihex .ihx`.
2. Gathers the generic input bundle from **the file's folder, `./conf/`, and `../conf/`**:
   - `*.nvmlayout.json` descriptors — **required**; with none, nothing renders.
   - `sources` — the files each descriptor **declares** (`{ logicalName: fileName }`); the
     core reads them and keys the content by logical name. The core does not know what any
     file means — e.g. Vector declares `{ "feeLcfg": "Fee_Lcfg.c" }`.
   - `arxml` — the nearest AUTOSAR config content, for adapters that consume it.
3. Calls `resolveNvmBlocks()`, which runs the registered adapters. **Every adapter is inert
   until a descriptor opts in**, so with no matching descriptor the result is empty and the
   file renders like the plain hex editor.
4. Only if no descriptor matched does it fall back to ARXML auto-load
   (`hexeditor.autoLoadArxml`, a separate legacy feature you can disable in settings).

> After any change you must **build** (`npm run compile`) and reload: run the
> **Extension Development Host** (F5) or "Developer: Reload Window" in it. The
> installed marketplace extension does not use your `dist/`.

> **New here?** Copy [nvmlayout.template.jsonc](nvmlayout.template.jsonc), strip the
> comments (a real descriptor must be strict JSON — use `_comment` keys for notes),
> and save it as `something.nvmlayout.json` next to your dump or in `conf/`.
> Note: an empty `"ext": []` / `"fileNameIncludes": []` means "no constraint".

---

## 3. Vector MICROSAR FEE V3 (link-table engine)

Vector's on-flash format is a **link-table (linked list)**; it can't be expressed as plain
block offsets, so it is decoded by the `vector-fee-v3` **engine**. The engine is **not**
auto-applied — you turn it on with a descriptor that sets `"provider": "vector-fee-v3"`.

### 3a. Minimal config (renders the RAD6xx demo)
Drop this next to the dump (or in `conf/`) as e.g. `conf/vector.nvmlayout.json`:

```json
{
  "vendor": "Vector MICROSAR FEE V3",
  "provider": "vector-fee-v3",
  "sources": { "feeLcfg": "Fee_Lcfg.c" },
  "match": { "ext": [".mot"] }
}
```

`sources` declares the auxiliary files the engine needs (`logicalName: fileName`); the core
reads `Fee_Lcfg.c` (from the dump folder / `./conf/` / `../conf/`) and hands its content to
the engine → block **names** and net lengths. This yields 51 units (2 sector tables + 49
named data blocks). Omit `sources` and you still get 51 blocks, but named `Tag N` with the
raw chunk size. Defaults when `options` are omitted: `alignment = 8`, `numberOfSectors = 2`,
`sectorSize = 0x30000`.

### 3b. Tuning the engine
If your project uses different container parameters, add `options`:

```jsonc
// e.g. conf/myecu.nvmlayout.json
{
  "vendor": "MyEcu (Vector FEE V3)",
  "provider": "vector-fee-v3",          // run the Vector engine…
  "match": { "ext": [".mot", ".s19"] }, // …only for these files (optional)
  "options": {
    "alignment": 8,                     // bytes; MICROSAR RAD6xx = 8
    "numberOfSectors": 2,
    "sectorSize": 196608                // 0x30000 (JSON has no hex → decimal)
  }
}
```

- `provider` selects a code engine by id; here it means "use the Vector link-table parser".
- `options` are forwarded to `parseVectorFeeV3` (`alignment`, `numberOfSectors`, `sectorSize`).
- A descriptor with `provider` set is handled by that engine — its `blocks` (if any) are ignored.

Symptom that you need this: the dump opens but **nothing colours / very few blocks**. Try
matching `sectorSize`/`alignment` to your MICROSAR FEE configuration. A wrong `sectorSize`
makes the parser find 0 chunks.

### 3c. Field structure in config (rename / recolor without code)
The Vector engine's code only *finds* the regions (the link-table walk — a linked list's
block locations are dynamic, so that part must be code). The **field breakdown** of each
region lives in `options.structure` and can be edited freely:

```jsonc
"options": {
  "structure": {
    "sectorHeader": [ { "name": "Counter / id", "kind": "counter", "offset": 0, "length": 1 }, … ],
    "slot":        [ { "name": "linkTarget", "kind": "linkTarget", "offset": 0, "length": 4 }, … ],
    "slotEmpty":   [ { "name": "unused slot", "kind": "linkEmpty", "offset": 0, "length": 8 } ],
    "chunkHeader": [ { "name": "tag", "kind": "tag", "offset": 0, "length": 2 }, … ],
    "marker":  { "name": "Padding / marker", "kind": "marker" },
    "payload": { "name": "Payload", "kind": "payload" }
  }
}
```

Offsets/lengths are **relative to the region start**. Any part you omit uses the built-in
default, so `structure` is entirely optional. Live values (tag numbers, sizes, the slot's
target block) are shown in the Data Inspector rather than baked into the field names.

### 3d. Business-struct decoding (DEM / reset context / any block) → Data Inspector

`structure` (§3c) only labels the *regions* of a chunk. To show a block's **business
meaning** — DEM records, a reset-reason/reset-context block, any calibration struct — bind a
**struct definition** to the block. The engine decodes that block's payload into a tree of
named, typed values (scalars, arrays incl. 2-D freeze frames, nested structs, bitfields,
enums, linear scaling) and the **Data Inspector** renders it for the selected block. Clicking
a decoded field reveals and selects its bytes.

This is **vendor-blind in the core**: the engine (not the plugin) reads the struct sources and
decides which block gets which struct. Struct/enum definitions come from any of three sources,
all compiled into one model:

- **inline JSON** — `options.structCatalog` (fastest to author),
- **generated C source** — declared under `sources` (e.g. `Dem_Types.h`, `FSMon_Cat2_Base.h`)
  and listed in `options.structs.fromSources` (`typedef struct`, arrays, `enum`, `#define`),
- **ARXML** — a `.arxml` under `sources` listed in `fromSources`
  (`IMPLEMENTATION-DATA-TYPE` + `SW-BASE-TYPE` + `COMPU-METHOD`).

> **Declare `NvM_Cfg.c` for an accurate struct-decode length.** `Fee_Lcfg.c` reports the
> *stored* payload length, which already includes the appended CMAC/CRC. If you bind a struct
> without also declaring `"nvmCfg": "NvM_Cfg.c"`, the engine has no way to know where the
> business data ends and would decode the struct into the integrity bytes. With `nvmCfg`
> declared, the engine reads `NvMNvBlockLength` (business length) and `NvMacSize` (integrity
> size) per block, decodes only the business data, and renders separate **payload / MAC-CRC /
> padding** regions. Example `Nvm_SafeSection_Index`: 1 data byte + 16-byte CMAC + 6 padding.

```jsonc
{
  "engine": "vector-fee-v3",
  "sources": {
    "feeLcfg": "Fee_Lcfg.c",
    "nvmCfg": "NvM_Cfg.c",              // business-data length + MAC size per block
    "demTypes": "Dem_Types.h",          // optional struct sources (C headers / ARXML)
    "arxmlTypes": "Types.arxml"
  },
  "options": {
    // 1) build the catalog: inline JSON merged with parsed sources
    "structCatalog": { "structs": { /* … */ }, "enums": { /* … */ } },
    "structs": { "fromSources": ["demTypes", "arxmlTypes"] },
    // 2) bind blocks → structs (the engine's decision; by name / glob / tag / identity)
    "blockStructs": [
      { "match": { "nameGlob": "Nvm_SafeSection_Data_Record*" }, "struct": "ResetContext" },
      { "match": { "name": "DemStatusDataBlock" },               "struct": "DemStatus" },
      { "match": { "tag": 49 },                                  "struct": "Cat2CrashDump" }
    ],
    // 3) by default only the CURRENT version of a bound block is decoded; set true to
    //    also decode historical (stale) copies for history/regression analysis.
    "decodeStale": false
  }
}
```

**Struct field schema** (`structCatalog.structs[name].fields[]`), each field is one of:

```jsonc
{ "name": "Temperature", "type": "u8", "compu": { "offset": -80 }, "unit": "degC" }   // scalar + linear scale
{ "name": "ContextEnvData", "type": "u8", "dims": [10] }                              // 1-D array
{ "name": "Snapshot", "type": "u8", "dims": [2, 8] }                                  // 2-D freeze frame
{ "name": "StartUp", "struct": "FSMon_StartUp" }                                      // nested struct
{ "name": "flags", "type": "u8", "bits": 4 }                                          // bitfield (4 bits)
{ "name": "ResetReason", "type": "u16", "compu": { "enum": "ResetReason" } }          // enum label
{ "name": "reserved", "type": "u8", "padding": 3 }                                    // skip 3 bytes first
{ "name": "ver", "type": "u32", "offset": 120 }                                       // explicit in-struct offset
```

- `type`: `u8/u16/u24/u32/u64` · `i8…i64` · `f32/f64` · `bool` · `bytes` · `ascii` (`size` bytes).
  64-bit values are reported as decimal strings.
- `dims`: array shape; a dimension may be a **string** naming a sibling field that holds the count.
- `endian`: `little` (default) / `big`, per field or per struct.
- `compu`: `{ factor, offset }` (physical = raw·factor + offset), `{ enum: "Name" }` /
  `{ enumInline: { "0": "OFF" } }`, or `{ opers: "*0.5, -273" }` (legacy `.blk` ops).
- `offset` / `padding` / `align`: explicit placement (reproduce C struct padding gaps).
- `format`: a rich display formatter (below).

Enums live in `structCatalog.enums[name].values` as `{ "<value>": "<label>" }` (optional
`width`, default 4 — the byte width of a field whose *type* is that enum). C `enum { A=0 }`
with integer initializers is scraped automatically, **including macro-computed values**
(`RESET_REASON(16u,1)` → `0x4010`, function macros are expanded and evaluated). Only enum
initializers that reference truly external/undefined symbols are skipped (reported as a
diagnostic) — supply those inline.

#### Enums from `#define` tables (`options.enumsFromDefines`) — e.g. DEM event ids

Some generated headers express a value list not as a C `enum` but as a "symbolic name value"
`#define` table, e.g. AUTOSAR's DEM event ids in `Dem_Lcfg.h`:

```c
#define DemConf_DemEventParameter_ADC_E_HARDWARE_ERROR   146u
#define DemConf_DemEventParameter_CANSM_E_BUSOFF_NETWORK_0 2u
```

`options.enumsFromDefines` scrapes such a table into a catalog enum (value → name, prefix
stripped) so a decoded field can label its value:

```jsonc
"options": {
  "enumsFromDefines": [
    { "enum": "DemEventName", "source": "demLcfg",
      "prefix": "DemConf_DemEventParameter_", "width": 2 }
  ],
  "blockStructs": [ { "match": { "nameGlob": "DemPrimaryDataBlock*" }, "struct": "Dem_Cfg_PrimaryEntryType" } ]
}
```

then bind the id field to it: `{ "name": "EventId", "format": { "kind": "enum", "enum": "DemEventName" } }`.
`source` is a logical name declared in `sources`; `prefix` is the macro-name prefix to require
and strip. This is **vendor-blind**: the kernel only knows `#define <prefix><NAME> <int>`; the
prefix (and which file) come from config. Backed by `sdk.parseDefineEnum` (SDK v4+).

#### Naming whole blocks from a `#define` table (`symbols.fromDefines`)

The same table can name *blocks* (not just decoded fields) for **built-in** layout tiers
(positional / structured). At the descriptor top level:

```jsonc
{
  "sources": { "demLcfg": "Dem_Lcfg.h" },
  "symbols": { "fromDefines": [ { "source": "demLcfg", "prefix": "DemConf_DemEventParameter_" } ] }
}
```

A `symbols` adapter scrapes the table to `id → name` and names any block whose
`raw.logicalId` matches (merged with the ARXML symbol adapter). Vendor knowledge stays in
config; the core only runs the generic scrape recipe.

#### Parsing real C headers (natural alignment, unions, bitfields, typedefs)

Point `options.structs.fromSources` at generated headers and the engine builds the catalog
from them — you rarely hand-write `fields`. The C parser handles: **natural C alignment**
(marks parsed structs `layout: "c"`; enums/`u32` align to 4, etc. — without this every offset
after a pad is wrong), **`#define`/`sizeof` array sizes** (`a[SIZE/sizeof(uint32)]`, resolved
across concatenated headers), **enum-typed fields** (AUTOSAR forces 4-byte enums), **C
bitfields** (`u_WdogTestStep : 4`), **anonymous nested `struct/union { … } x[N]`**, **typedef
arrays/aliases** (`typedef uint8 X[8]`), and strips `P2VAR/VAR/CONST(…)` wrappers. Multiple C
headers are **concatenated before parsing** so a size macro in one header (e.g.
`FS_SafeSection_Prv.h`) feeds an array in another (`FS_SafeSection_Types.h`). If an `#include`d
size header or a macro-computed enum is missing, the missing pieces are reported as diagnostics
(logged by the engine) and you fill them via the inline `structCatalog`.

The inline `structCatalog` is an **overlay**: it patches parsed structs *by field name* (attach
a `format`, a union `discriminator`/`cases`) without re-listing every field, and adds/overrides
enums. A struct present only inline is added whole. So a typical descriptor parses layout from
`.h` files and uses inline JSON only for presentation + gap-fill.

#### `union` + discriminator

A `union` def overlays all members at offset 0; a field referencing it picks the active member
from a sibling's value:

```jsonc
"Shared": { "discriminator": "e_SharedInfoID",
            "cases": { "1": "Mcu", "2": "Task", "default": "Mcu" } }
```

#### Rich formatters (`format`) — config-driven presentation

`format` turns a raw value into the kind of readout the reference NvmAnalyzer produced. All
kinds are generic (no vendor/use-case knowledge — the config chooses per field):

| kind                           | renders                                                            | key params                               |
|--------------------------------|--------------------------------------------------------------------|------------------------------------------|
| `hex` / `dec` / `both`         | `0x1B` / `27` / `0x1B - 27`                                        | —                                        |
| `enum`                         | value → label                                                      | `enum` / `inline`                        |
| `version`                      | `138.022.008 RELEASE` (bytes → `%03d.%03d.%03d` + build byte name) | `parts`, `buildEnum`, `sep`              |
| `duration`                     | `1955 ms - 00:00:01,955`                                           | `unit` (`ms`/`s`/`us`)                   |
| `bitflags`                     | expands to a child row per bit `7 - Warning… - TRUE`               | `flags` or `inline` (bit→label)          |
| `scaled` / `temp` / `odometer` | `raw·factor+offset` (+unit; `odometer` sentinel→`none`)            | `factor`, `offset`, `sentinel`, `suffix` |
| `ascii`                        | `00 6F 5A - .oZ` (hex + printable tail)                            | —                                        |
| `expr`                         | whitelisted arithmetic over `value` (+ sibling fields)             | `expr`, `hex`, `prefix`, `suffix`        |

Example (DEM UDS status byte → 8 named bits, SafeSection version + time):

```jsonc
{ "name": "StatusByte",   "format": { "kind": "bitflags", "inline": { "7":"Warning indicator requested", "0":"Test failed" } } }
{ "name": "u_SwVersion",  "format": { "kind": "version", "buildEnum": "FS_InfoBlockBuildType" } }
{ "name": "u_CycleCounter","format": { "kind": "duration", "unit": "ms" } }
```

Bind only your handful of business blocks — decoding is skipped for everything else, so the
~thousands of historical chunks cost nothing. The `nextLink` "previous version" jump (§4b)
plus `decodeStale: true` lets you walk a block's history and compare decoded values across
writes.

> CLI check (no editor): `node dist/nvmcli.js decode-rich <dump.mot> --catalog cat.json
> --struct <Name> --at <addr>` prints the decoded tree. `--source <file.h|.arxml>` merges a
> parsed source into the catalog.

---

## 4. Other vendors — config-driven (`*.nvmlayout.json`, no code)

For non-linked-list layouts (top-down sequential dumps, dual-ended rings, fixed tables),
describe the blocks directly. Drop the JSON next to the dump or in `conf/`.

### Schema
```jsonc
{
  "vendor": "Acme NVM",                 // shown as the block/unit name prefix
  "match": {                            // optional gate; omit to match any opened dump
    "ext": [".bin", ".mot"],
    "fileNameIncludes": ["acme"]        // case-insensitive substring(s)
  },
  "baseAddress": 4194304,               // optional ABSOLUTE base that maps to editor 0
                                        // (editor offset = absoluteAddr - imageBase)
  "arrangement": "sequential",          // informational; per-block `from` controls placement
  "blocks": [
    {
      "name": "Boot",
      "length": 16,                     // bytes
      // "offset": 0,                   // explicit editor offset (else auto-placed)
      // "from": "top" | "bottom",      // auto-place from top (default) or bottom
      "fields": [                       // sub-attributes, offsets RELATIVE to the block
        { "name": "magic", "kind": "header",  "offset": 0,  "length": 4 },
        { "name": "data",  "kind": "payload", "offset": 4,  "length": 10 },
        { "name": "crc",   "kind": "crc",     "offset": 14, "length": 2 }
      ]
    },
    { "name": "Calibration", "length": 512 },     // no fields -> whole block is one payload
    { "name": "Tail", "length": 8, "from": "bottom" }  // grows up from the end of the image
  ]
}
```

Placement rules per block:
- `offset` given → used verbatim (editor byte offset).
- else `from: "bottom"` → placed against a pointer growing up from the image end
  (use this for "both ends toward the middle").
- else → placed against a pointer growing down from `baseAddress` (top-down sequential).

Each block becomes one clickable **unit**; its `fields` are the coloured attributes.

---

## 4b. In-file address links (`link`) — make a pointer field jump

A field whose bytes hold an address that points **inside the current file** can be made
clickable. Add a `link` to the field; the adapter decodes the bytes, applies an optional
safe `transform`, range-checks the result, and — when valid — the field jumps there.

```jsonc
{ "name": "linkTarget", "kind": "linkTarget", "offset": 0, "length": 4,
  "link": {
    "encoding": "u32le",              // u16le | u16be | u32le | u32be
    "transform": "value - imageBase", // optional; omit to use the raw value
    "label": "block"                  // optional; shown on the Jump affordance
  }
}
```

- `transform` reuses the same safe evaluator as everything else (no `eval`). Scope vars:
  `value` (the decoded address), `imageBase` (absolute base mapped to editor 0), `fileSize`
  (decoded image length), plus vendor extras (e.g. Vector `chipBase`) where relevant.
- The result must satisfy `0 <= targetOffset < fileSize`, otherwise **no** link is offered
  (silent — the field just isn't clickable).
- Only the resolved editor `targetOffset` reaches the display, so the UI stays dumb.

**How to use it in the editor:**
- Select the field's unit (single click), then **Ctrl/Cmd-click** the linked cell to jump
  (plain click is reserved for selection). Linked cells are underlined with a pointer cursor.
- Or use the **Jump →** button in the hover tooltip and in the Data Inspector.

**Vector FEE V3:** the slot's `linkTarget` is a link out of the box — its target is the
data chunk the slot points at (resolved by the link-table walk, so no `transform` is
needed). Ctrl/Cmd-click any used slot's first four bytes to jump to that block. This lives
in `options.structure.slot`, so you can rename/recolor it or drop the `link` to disable.

---

## 5. Colors are config-driven (no hardcoded palette)

`kind` is just a label you choose. A field's color is resolved in this order, entirely from
config:

1. the field's own `"color"` (any CSS color), else
2. the descriptor `"palette"[kind]`, else
3. a deterministic auto color generated from the `kind` string (`colorForString`).

No per-kind colors live in the extension code. Put the style where the structure is:

```jsonc
"palette": {
  "counter": "hsl(0 75% 80%)",
  "payload": "hsl(140 55% 82%)",
  "crc":     "#c9a0ff"
}
```

or per field: `{ "name": "crc16", "kind": "crc", "offset": 30, "length": 2, "color": "#f88" }`.
A suggested naming set (all free-form): `header`, `tag`, `size`, `reserved`, `marker`,
`payload`, `crc`, `padding`, `counter`, `ltSize`, `status`, `linkTarget`, `payloadSize`,
`pad`, `linkEmpty`.

---

## 6. How it renders (so you know it's working)

- Colouring is **selection-driven**: nothing is tinted until you click. Clicking a byte
  highlights only its **unit** (a data block, a sector header, or one table slot); every
  other byte stays exactly like the plain hex editor.
- Coloured cells use dark bold text for contrast.
- The **Data Inspector** (side panel + hover) shows, for the focused byte: block name,
  attribute (field) name, `kind`, the field's byte range, and the value in hex · dec · binary.

---

## 7. Advanced — a code-based provider

For complex/linked formats (like Vector), implement the interface in its own file under
`src/nvm/layout/` and register it:

```ts
// src/nvm/layout/myVendor.ts
import { LayoutInput, NvmLayoutProvider } from "./provider";

export const myVendorProvider: NvmLayoutProvider = {
  id: "my-vendor",
  label: "My Vendor NVM",
  detect: input => input.ext === ".bin" /* cheap sniff */,
  parse: input => {
    // decode input.text (or your own bytes) and return NvmBlockInfo[]
    // each field: { name, kind, offset /* editor byte offset */, length, unit }
    return [];
  },
};
```

```ts
// src/nvm/layout/index.ts  — register (last registered is tried first)
import { registerLayoutProvider } from "./provider";
import { myVendorProvider } from "./myVendor";
registerLayoutProvider(myVendorProvider);
```

Providers are isolated: one that throws is skipped, it never breaks the others.

---

## 7b. External (runtime-loaded) engines — desktop only

A code engine can also live **outside** the extension, as a workspace script loaded at
runtime. Editing the script (or adding a new one) changes the layout with **no rebuild** —
the editor hot-reloads it while the dump is open. This is the way to iterate on a parser or
add a vendor without touching the extension source.

> **Security:** an engine script is executed as JavaScript in the desktop extension host.
> It is therefore gated four ways and is **never** available in the web build
> (`vscode.dev`) or in an untrusted workspace:
> 1. desktop (Node) host only,
> 2. **Workspace Trust** must be granted,
> 3. the setting **`hexeditor.nvm.allowExternalEngines`** must be `true` (default `false`),
> 4. a one-time **per-file confirmation** ("Run once" / "Always run this file").

### Wire it up
```jsonc
// conf/vector.external.nvmlayout.json
{
  "vendor": "Vector FEE V3 (external engine)",
  "engineScript": "./vectorFeeV3.engine.js",   // resolved near the dump (./ , ./conf , ../conf)
  "match": { "ext": [".mot"] },
  "sources": { "feeLcfg": "Fee_Lcfg.c" },       // aux files, keyed by logical name
  "options": { "alignment": 8, "numberOfSectors": 2, "sectorSize": 196608 },
  "palette": { "payload": "hsl(140 55% 82%)" }
}
```
When present and the gate passes, `engineScript` runs **instead of** the built-in registry.
Otherwise the editor falls back to the built-in providers, so a descriptor can safely ship
both `engineScript` and a `provider`/`blocks` fallback.

### Write an engine
An engine is a Node module exporting `createEngine(sdk)`. Start from the shipped templates:
`media/nvm-engines/template.engine.js` (commented skeleton) and
`media/nvm-engines/vectorFeeV3.engine.js` (delegates to the built-in Vector pipeline).

```js
module.exports.createEngine = sdk => ({
  id: "my-engine",
  // input = { fileName, ext, text, configs, sources, arxml }; returns NvmBlockInfo[]
  parse(input, options) {
    const image = sdk.loadHexImage(input.text);
    const { baseAddress, bytes } = image.toFlat(0xff);
    // …build blocks; field offsets are EDITOR byte offsets (0 = image base)…
    return [];
  },
});
```

- `sdk` is the **injected, versioned NVM kernel** — engines never bundle their own copy:
  `sdk.version`, `loadHexImage`, `parseVectorFeeV3`, `parseFeeLcfg`, `feeLcfgByTag`,
  `computeCrc`, `evaluateExpression`, `resolveFieldLink`, `buildFeeV3Blocks`.
- The engine consumes the same `LayoutInput` and returns the same `NvmBlockInfo[]` as the
  built-ins, so the unified model and the whole display are unchanged.
- ESM (`export function createEngine`) also works. If your workspace `package.json` sets
  `"type": "module"`, use `export`; otherwise CommonJS `module.exports` is fine (or name the
  file `*.engine.cjs` to force CommonJS).

### Hot reload
While a dump is open, saving the engine file re-parses it and re-colours the view
automatically (the import cache is keyed by file mtime).

---

## 8. Troubleshooting

| Symptom                                       | Likely cause / fix                                                                                                                                                                                            |
|-----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Nothing colours anywhere                      | No matching descriptor — rendering is config-driven, so add a `*.nvmlayout.json` (Vector: set `provider: "vector-fee-v3"`; §3a). Also confirm you reloaded the **dev host** (F5) after `npm run compile`.     |
| Vector dump, few/zero blocks                  | Container params off — add `options` with correct `sectorSize` / `alignment` / `numberOfSectors` (§3b).                                                                                                       |
| Blocks named `Tag N`                          | `Fee_Lcfg.c` not found — place it in the dump folder, `./conf/`, or `../conf/`.                                                                                                                               |
| Config ignored                                | File must end with `.nvmlayout.json`; must have `blocks` (config layout), `provider` (built-in), or `engineScript` (external). Check the extension host console for "Ignoring invalid NVM layout descriptor". |
| `engineScript` never runs                     | It is desktop-only and gated: trust the workspace, set `hexeditor.nvm.allowExternalEngines: true`, accept the confirmation, and confirm the script resolves near the dump (§7b).                              |
| Linked field won't jump                       | The decoded/transformed target must land in `[0, fileSize)`; otherwise no link is offered. Select the field's unit first, then **Ctrl/Cmd-click** (plain click only selects). See §4b.                        |
| Addresses differ from datasheet by a constant | The gutter is 0-based into the decoded image (offset 0 = image base, e.g. `0x3a0000`). Editor offset = absolute − imageBase.                                                                                  |

---

## 9. Quick CLI check (no editor)

```powershell
cd "D:\02_Work\external_repo\microsoft\vscode-hexeditor"; npm run nvmcli:build
node dist/nvmcli.js feev3 "<dump>.mot" --lcfg "<Fee_Lcfg.c>" `
  --align 8 --sectors 2 --sectorsize 0x30000     # tune to confirm params, then mirror into the JSON
```
