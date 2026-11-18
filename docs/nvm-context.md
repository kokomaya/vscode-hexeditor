# NVM Studio — Project Context & Handoff

> Attach this file at the start of a new conversation. It contains every resource,
> path, command and verified fact needed to continue without re-discovery.
> A machine copy lives in repo memory: `/memories/repo/nvm-fee-format.md`.
> Use arxml whenever possible for configuration; only use source files as a last resort. To read arxml or xdm configurations, you can use the metamodel example: D:\02_Work\repo\Others\autosar_parser or D:\02_Work\repo\Tools\nvm_assistant_demo\nvm_lifetime_estimation.py

---

## 1. Mission

Turn `vscode-hexeditor` into a **config-driven, vendor-agnostic, AI-assisted AUTOSAR
NVM analysis platform** (extracting the C# `NvmAnalyzer` functionality). All config
comes from AUTOSAR files (ARXML + generated `Fee_Lcfg.c`); nothing hard-coded.
Layers: L1 container/FEE, L2 block location, L3 CRC, L4 crypto, L5 struct→physical.

---

## 2. Workspace layout (multi-root)

| Role                     | Path                                                  |
|--------------------------|-------------------------------------------------------|
| Code (VS Code extension) | `d:\02_Work\external_repo\microsoft\vscode-hexeditor` |
| C# reference tool        | `d:\03_Tools\NvmAnalyzerSourceCode`                   |
| Demo data + configs      | `d:\02_Work\repo\Tools\nvm_assistant_demo`            |

---

## 3. Code produced (all in `vscode-hexeditor`)

Kernel (browser+node safe) under `shared/nvm/`:
- `model.ts` — `NvmModel/NvmBlock/NvmBlockInstance/NvmIssue/NvmSector/ByteRange/DecodedField`.
- `crc.ts` — Rocksoft `computeCrc`, 6 presets, `resolveCrcPreset` (verified vs standards).
- `expr.ts` — safe whitelist expression evaluator (no `eval`).
- `profile.ts` — profile schema + `validateProfile`.
- `engine.ts` — `parseNvm` linear block engine (M0).
- `memoryImage.ts` — `MemoryImage` (sparse segments, `read()`, `toFlat(fill)`, `baseAddress`).
- `loaders.ts` — `parseSRecord` (S1/S2/S3), `parseIntelHex`, `loadHexImage` (auto-detect).
- `struct.ts` — `.blk` decoder: `parseBlkStruct`, `decodeStruct`, `applyOpers`, `structByteLength`.
- `arxml/` — `xml.ts` (dep-free parser), `ecuc.ts` (EcucModule reader), `nvmImport.ts` (`importNvmCatalog`).
- **`vendor/`** — `feeLcfg.ts` (`parseFeeLcfg`, `feeLcfgByTag`), `vectorFeeV3.ts`
  (`parseVectorFeeV3`), `feeV3Model.ts` (`buildFeeV3Model` → `NvmModel`).
- `index.ts` — barrel exporting everything above (incl. `./vendor`).

Extension host / tooling:
- `src/fileSystemAdaptor.ts` — `DecodedImageFileAccessor`; `.mot`/S-record/HEX decode to bytes; `.bin` raw.
- `tools/nvmcli.ts` — CLI: `parse | crc | image | decode | import | feev3`.
- Tests (registered in `src/test/index.ts`): `nvmKernel.test.ts`, `nvmLoaders.test.ts`,
  `nvmArxml.test.ts`, `nvmVectorFeeV3.test.ts`.
- `docs/design.md` — full design (5 layers, AI channels, roadmap, TODO-B/C/Vector/Import).

Editor UI integration (DONE — see §10 for details):
- `src/nvm/feeV3Blocks.ts` — `buildFeeV3Blocks(text, feeLcfg?)` → `NvmBlockInfo[]` with
  fine-grained byte-level sub-fields (sector header, each link-table slot, each chunk).
- `src/nvm/layout/` — **vendor-pluggable layout registry** (`provider.ts`, `vectorFeeV3.ts`,
  `configLayout.ts`, `index.ts`). `resolveNvmBlocks(input)` picks the first matching provider.
- `src/hexEditorProvider.ts` — `tryLoadNvmBlocks()` auto-detect on open → `SetNvmBlocks`.
- `shared/protocol.ts` — `NvmBlockInfo` / `NvmFieldInfo` (`{name,kind,offset,length,unit?}`).
- `media/editor/state.ts` — `nvmBlocksAtom`, `nvmFieldRanges`, `nvmFieldRangesPage(pageNo)`,
  `selectedNvmUnitAtom`, eager `SetNvmBlocks` handler (startup-race safe).
- `media/editor/dataDisplay.tsx` — per-byte, selection-driven cell coloring by field kind.
- `media/editor/dataInspector.tsx` — `NvmByteExplain` (per-byte attribute/value in inspector).
- `media/editor/util.ts` — `colorForNvmField(kind)` palette.

---

## 4. Reference resources (C# `NvmAnalyzer`) — read only when needed

| File                                           | Contains                                                                                              |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `NvmAnalyzer\NvmAnalyzer\NvmVector3.cs`        | **V3 parser** — `SectionV3`, `ChunkLinkV3`, `FeeBlockV3`, `ChunkHeader` (the format used by the demo) |
| `NvmAnalyzer\NvmAnalyzer\NvmVector2.cs`        | V2 sequential-scan parser (older layout)                                                              |
| `NvmAnalyzer\NvmAnalyzer\MotfParser.cs`        | `ExtractBlocksV2/V3`, `SectConf`, sector setup                                                        |
| `Common\shared\Memory.cs`                      | byte readers: `GetMem2/4`, `GetMem2Swp/4Swp` (LE), `GetMemList`, `ByteListCompare`, `SwapBytes*`      |
| `Common\sharedConti\sharedConti\CodeParser.cs` | `GetFeeTabBlk`/`GetFeePlSize` (find `BlkIdx==tag`), `ParseFeeTabVE`, `ParseMemConf`                   |

---

## 5. Demo data / configs (`nvm_assistant_demo`)

| File                           | Use                                                                 |
|--------------------------------|---------------------------------------------------------------------|
| `demo\NVM_test.mot`            | Real Vector NVM dump (S2, base `0x3a0000`, 2×`0x30000`)             |
| `conf\Fee_Lcfg.c`              | **tag(BlkIdx) → payloadLength → name** (required to name chunks)    |
| `conf\NvM_Cfg.c` / `NvM_Cfg.h` | NvM block ↔ name, **`NvMNvBlockLength` (data) + `NvMacSize` (MAC)** |
| `conf\Fee_Cfg.h`               | `FeeBlockNumber` macros (≠ link-table index)                        |
| `help.md`                      | Another AI's PlantUML layout guess (partly right, see §7)           |

---

## 6. Commands

```powershell
# Build the CLI bundle
cd "D:\02_Work\external_repo\microsoft\vscode-hexeditor"; npm run nvmcli:build   # -> dist/nvmcli.js

# Parse every NVM block in the demo image
node dist/nvmcli.js feev3 "d:\02_Work\repo\Tools\nvm_assistant_demo\demo\NVM_test.mot" `
  --lcfg "d:\02_Work\repo\Tools\nvm_assistant_demo\conf\Fee_Lcfg.c"          # add --json for machine output

# Inspect raw decoded bytes
node dist/nvmcli.js image "<file.mot>" --at 0x3d0000 --len 64

# Type-check
npx tsc --noEmit
```

**Testing caveat:** `npm test` is blocked by a pre-existing
`@vscode/extension-telemetry` named-import error in 3 unmodified files. Run a spec in
isolation: create `tools/_test_runner.ts` (mocha + `require` the spec), bundle with
`npx esbuild ... --outfile=dist/_test_runner.js`, `node` it, then delete the temp files.
`npx tsc --noEmit` and `npm run nvmcli:build` both pass.

---

## 7. VERIFIED FEE V3 format (the key knowledge)

- File = Motorola **S2** records, base `0x3a0000`, **2 sectors** of `0x30000`.
- **Active sector** = header first byte ≠ `0xff` (erased sector is `0xff` after header).
- Sector header: `id(1) blkHi(1) blkLo(1)` → `ltSize = (blkHi<<4)|blkLo` (=80).
- **alignment = 8** (NOT 256).
- **Link table** at `sectorStart + alignment`: `ltSize` slots × 8 bytes =
  `linkTarget(4 LE) payloadSize(2 LE) pad(2)`. `0xFFFFFFFF` slot = unused block.
  **slot index == chunk tag == `Fee_Lcfg` BlkIdx.**
- `linkTarget` carries a chip bank prefix (`0x013a0000`);
  `chipBase = (linkTarget & 0xff000000) | (base & 0xffffff)`, `fileOffset = linkTarget - chipBase`.
- Chunk located by walking **backwards** from `linkTarget`:
  `la-=al` (expect `0x0A` end marker); `la-=pldSz+1` (expect `0x0A` start marker); `la-=al`; `la-=8` → chunk header.
- Chunk header (`FeeBlockV3.Parse`): `tag(2 LE) skip(2) size(4 LE)`; align `idx` up to `al`;
  `0x0A` marker; payload = `size` bytes after marker. Net length = `Fee_Lcfg` payloadLength.
- `GetMem2Swp/4Swp` = **little-endian**; `GetMem2` = big-endian; INVAL pattern = `05 05 05 05`.

**Validated:** 49/49 written blocks, every `slot==tag`; `PartNumber_F187`="3604010-PT307",
`FBLSoftVer`="V1.17". VIN is binary → **AES-CBC-256 encrypted** (L4, not yet implemented).

more info also avaiable in：vscode-hexeditor\docs\nvm-fee-v3-layout.md

help.md was **right** about: link-table-driven, tag = lookup-table index, ~0x50 block
total, 8-byte granularity. **Wrong** about: it's V3 not V2; alignment 8 not 256; link
target points *past* the chunk (walk backwards); per-page byte offsets don't hold.

---

## 8. Status & next steps

Done: M0 kernel, S-record/HEX loaders, `.blk` struct decoder, ARXML importer, S-record
editor integration, **FEE V3 block parser + NvmModel builder + CLI + tests**,
**editor UI integration** (per-byte colouring, selection-driven, data-inspector byte
explain), **vendor-pluggable layout registry** (§10).

Open:
1. ~~**Editor wiring**~~ — DONE (§10).
2. **L3 CRC** — CRC16-CCITT-FALSE over payload (last 2 bytes stored big-endian); report, don't fail (IgnoreCrc).
3. **L4 crypto** — AES-CBC-256 decrypt for encrypted blocks (e.g. VIN); key source TBD.
4. ~~**L5 struct**~~ — DONE (SDK v3): rich per-block struct decoding (`shared/nvm/structRich.ts`) →
   `NvmBlockInfo.decoded` tree in the Data Inspector; block↔struct bound by the engine via
   `options.blockStructs`; sources = inline JSON / C source (`cstruct.ts`) / ARXML (`arxmlStructs.ts`).
   See [nvm-layout-providers.md](nvm-layout-providers.md) §3d.
5. **Auto-config** — detect vendor/version + params (align, sectors, base) from ARXML/`.inc` instead of CLI flags.
6. **AI channels** — LM Tools / MCP / CLI expose parse + query (design §8).
7. **`.bin` support** — config layout provider currently only runs on S-record/HEX text; add raw-binary path.
8. **More vendors** — EB Tresos / Vector FEE V2 / EA-EEPROM as new `src/nvm/layout/*` providers.

---

## 9. Scenario prompts (copy-paste to start a task)

**A. Wire into the hex editor UI** — DONE (see §10). Remaining polish only.
> The FEE V3 model is wired into the webview: per-byte colouring (selection-driven,
> unit granularity), data-inspector byte explain, vendor-pluggable layout registry.
> Extend from `src/nvm/layout/`, `media/editor/dataDisplay.tsx`, `dataInspector.tsx`,
> `state.ts`. See §10.

**B. Add CRC (L3)**
> Add CRC16-CCITT-FALSE verification to `feeV3Model.ts`: for each block compute CRC over
> the net payload minus its trailing 2-byte big-endian CRC, fill `CrcResult.stored/computed/valid`,
> and emit an `NvmIssue` on mismatch (severity info — IgnoreCrc). Use `computeCrc` from
> `shared/nvm/crc.ts`. Add a test. See docs/nvm-context.md §7,§8.

**C. Add decryption (L4)**
> Implement AES-CBC-256 decryption for encrypted FEE blocks (e.g. VIN). Determine which
> blocks are encrypted (from ARXML NvMExtraInfo / config), decrypt the stored payload in
> `feeV3Model.ts`, and expose `crypto:{algo,decrypted}`. Reference C# `crypt.DecryptPayld`
> and `GetPayload` in NvmVector3.cs. See docs/nvm-context.md §4,§7.

**D. Per-block struct decoding (L5)**
> Attach `.blk` struct decoding to each FEE V3 block so the data inspector shows physical
> values. Use `parseBlkStruct`/`decodeStruct` from `shared/nvm/struct.ts`. Resolve the
> block→struct mapping ([TODO-B]) — start with a manual "assign struct to selected block"
> command, config-driven later. See docs/nvm-context.md §3,§8.

**E. Support another vendor / FEE version**
> Add a new provider under `src/nvm/layout/` implementing `NvmLayoutProvider`
> (`{id,label,detect,parse}`) and `registerLayoutProvider(...)` it in `index.ts`.
> For code-based vendors port from the matching C# class (NvmVector2.cs / NvmEaArs3.cs /
> MotfParser.cs); for simple sequential/dual-ended layouts just ship a `*.nvmlayout.json`
> descriptor (config-driven provider, no code). Output `NvmBlockInfo[]` with per-field
> `unit`. See §10.

**F. Debug / parse a new dump**
> Parse `<new.mot>` with `node dist/nvmcli.js feev3 <new.mot> --lcfg <its Fee_Lcfg.c>`.
> If tags don't resolve or `slot!=tag`, dump bytes with `node dist/nvmcli.js image ...`,
> re-check active sector / alignment / chipBase against docs/nvm-context.md §7, and adjust
> `parseVectorFeeV3` options (`alignment`, `numberOfSectors`, `sectorSize`).

**G. Auto-detect config from ARXML**
> Extend `importNvmCatalog` (`shared/nvm/arxml/`) to also yield the FEE V3 runtime params
> (base address, sector size/count, alignment, vendor/version) so `feev3` needs no manual
> flags. Cross-check against the demo `.inc`/ARXML. See docs/nvm-context.md §3,§8.

---

## 10. Editor UI integration (DONE) — how it renders in the hex view

### Data flow
1. **Open** a `.mot`/S-record/HEX file → `fileSystemAdaptor.ts` decodes it to a flat
   image (editor byte 0 = image base, e.g. `0x3a0000`).
2. `hexEditorProvider.resolveCustomEditor` runs `tryLoadNvmBlocks()` which gathers a
   **generic input bundle** (dump text + `*.nvmlayout.json` descriptors + config-declared
   `sources` files + nearest `arxml`), then calls `resolveNvmBlocks()` (the layout
   registry). The core has **no vendor knowledge** — descriptors declare which source files
   they need (e.g. Vector: `sources:{feeLcfg:"Fee_Lcfg.c"}`). Every adapter is config-driven;
   with no matching descriptor nothing renders, only then does it try ARXML auto-load.
3. Blocks are stashed in `HexEditorRegistry` **and** pushed via `SetNvmBlocks`. The
   webview handler is registered **eagerly at module load** (`media/editor/state.ts`,
   `latestNvmBlocks` + `nvmBlockListeners`) so the startup push is never lost to a race —
   this was the bug behind "nothing renders".
4. Webview: `nvmBlocksAtom` → `nvmFieldRanges` (flatten) → `nvmFieldRangesPage(pageNo)`
   (virtualised per visible page). `dataDisplay.tsx` colours each byte by its field.

### Block / field model (`NvmBlockInfo` / `NvmFieldInfo` in `shared/protocol.ts`)
- `offset`/`length` are **editor byte offsets** = `absoluteChipAddr − imageBase`.
- Each field: `{ name, kind, offset, length, unit? }`. `kind` picks a colour
  (`media/editor/util.ts` `colorForNvmField`); `unit` groups fields into a clickable unit.
- `feeV3Blocks.ts` emits **fine-grained sub-fields**:
  - Sector: `counter(1)` / `ltSize(2)` / `status(rest)`; unit `sector{bank}:header`.
  - Each link-table slot: `linkTarget(4)` / `payloadSize(2)` / `pad(2)`; unit
    `sector{bank}:slot{N}` (unused slot → single `linkEmpty`).
  - Each chunk: `tag(2)` / `reserved(2)` / `size(4)` → `marker` → `payload`; unit `tag{N}`.

### Rendering behaviour (user-requested)
- **Selection-driven**: nothing is coloured until you click. Clicking a byte sets
  `selectedNvmUnitAtom = field.unit`; only fields of that unit are coloured — the render
  unit is a **data block**, a **sector header**, or **one sector-table slot**. Everything
  else looks exactly like the stock hex editor. Clicking free space clears it.
- **Contrast**: coloured cells force `color:#1f1f1f; font-weight:600` on the light pastel
  background (`dataDisplay.tsx` `DataCell` inline style).
- **Data Inspector** (`dataInspector.tsx` `NvmByteExplain`, in both hover + side panel):
  for the focused byte shows block name, attribute (field name), kind, field byte range,
  and value as hex · dec · binary.

### Vendor-pluggable layout registry (`src/nvm/layout/`) — fully config-driven
- **No format auto-applies.** Every engine is inert until a `*.nvmlayout.json` opts in;
  with no matching descriptor the file renders like the plain hex editor.
- `provider.ts` — `NvmLayoutProvider {id,label,detect(input),parse(input)→NvmBlockInfo[]}`,
  `registerLayoutProvider`, `resolveNvmBlocks(input)` (isolates throwing engines).
- `vectorFeeV3.ts` — Vector FEE V3 link-table **engine**; runs ONLY when a descriptor sets
  `"provider":"vector-fee-v3"` (optionally with `options{alignment,numberOfSectors,sectorSize}`).
- `configLayout.ts` — **config-driven** engine reading `*.nvmlayout.json`:
  `{ vendor, match{ext,fileNameIncludes}, baseAddress?, arrangement, blocks[] }`;
  each block `{ name, length, offset?, from:"top"|"bottom", fields[] }`. Supports top-down
  sequential, per-block `from:"bottom"` (both-ends-to-middle), and explicit offsets — no code.
- `index.ts` — registers the engines. **Add an engine** = new provider file +
  `registerLayoutProvider`; **use it** = a `*.nvmlayout.json` beside the dump / in `conf/`.
- `hexEditorProvider.findLayoutConfigs()` scans `dir`, `dir/conf`, `../conf` for descriptors.
- **How-to guide (Vector config + other vendors + schema):** see
  [nvm-layout-providers.md](nvm-layout-providers.md).

### Build / verify / run
- Build: `npm run compile` (tsc + esbuild → `dist/`). Type-check: `npx tsc --noEmit`.
- To see changes: run the **Extension Development Host** (F5) or "Developer: Reload Window"
  in it — the installed marketplace extension does **not** use `dist/`.
- Demo lives entirely in **sector 1 @ editor `0x30000`** (active, `C5`, 49 used slots);
  sector 0 @ `0x0` is the empty spare (`C6`, all-`0xFF` table). Scroll to `0x30000`.
- Isolated provider check pattern: bundle a temp `tools/_*.ts` with esbuild → `node` it →
  delete (see repo memory `/memories/repo/nvm-fee-format.md`).
