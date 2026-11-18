# NVM capabilities (the vendor-blind input boundary)

The plugin **core** does not know about source code, AUTOSAR `arxml`/`xdm`, or any vendor
layout parser. It understands only a small set of **capabilities** and waits for pluggable
**adapters** to produce them. Every "where did this data come from" concern lives in an
adapter, never in the core. Contracts are defined in
[`shared/nvm/capabilities.ts`](../shared/nvm/capabilities.ts); adapters + registries live in
[`src/nvm/layout/context.ts`](../src/nvm/layout/context.ts).

## The five capabilities

| Capability    | Contract the core consumes                       | Built-in adapter(s)                      |
|---------------|--------------------------------------------------|------------------------------------------|
| `image`       | `ImageData` — `{ bytes, baseAddress }`           | `srecordImage.ts` (S-record / Intel HEX) |
| `symbols`     | `SymbolTable` — `id → { name, length, type, … }` | `arxmlSymbols.ts` (AUTOSAR ECUC)         |
| `layout`      | `NvmBlockInfo[]` — block/field geometry          | config T0/T1, external engine T2         |
| `struct`      | `StructDef` / `NvmStructCatalog` — business decode | `.blk` text, C source, ARXML, inline JSON |
| `annotations` | notes / tags / bookmarks                         | `annotationService`                      |

Nothing above names a file format or a vendor. An adapter that reads a `.map` file, DWARF debug
info, or an `.xdm` config would register as another `symbols` provider and the core would be
none the wiser.

## How resolution flows

`src/hexEditorProvider.ts` (`tryLoadNvmBlocks`) does:

1. Gather the descriptors (`*.nvmlayout.json`), declared `sources`, and nearby config, exactly
   as before — the host reads files (the web build has no `fs`, so content is passed in).
2. **image**: `resolveImage({ fileName, ext, text })` → `ImageData`. Decoded **once**.
3. Build the vendor-blind `ResolveContext`: `{ fileName, ext, image, configs, sources, symbols() }`.
   `symbols()` is **lazy + cached** — an adapter only parses AUTOSAR config if a layout provider
   asks for names.
4. **layout**: `resolveNvmBlocks(ctx)` runs the registered layout providers (first that yields
   blocks wins), then enriches block `name`s from `ctx.symbols()` when a block's logical id
   matches a symbol.

## Registering an adapter

```ts
import { registerImageProvider, registerSymbolProvider } from "./context";

registerImageProvider({
  id: "my-bin-image",
  detect: dump => dump.ext === ".bin",
  provide: dump => ({ bytes: /* … */, baseAddress: 0 }),
});

registerSymbolProvider({
  id: "my-map-symbols",
  detect: ctx => ".map file present",
  provide: ctx => ({ byId: new Map(/* id → { name, length } */) }),
});
```

Symbol adapters are **merged** (the first to define an id wins; later ones fill gaps), so
multiple sources (names from one, lengths from another) compose. Image adapters are
**first-match** (one decoder wins). Both isolate throwers.

## The external-engine boundary (legacy `LayoutInput`)

Installed engine packs (see [`engines/`](../engines/)) are a **public contract**: their
`parse(input, options)` receives the legacy `LayoutInput` (`{ fileName, ext, text, sources,
arxml?, configs }`). That shape is intentionally preserved so existing packs keep working —
the host still builds it for the engine path. Only the **built-in** provider boundary moved to
`ResolveContext`.

## Design rationale

- **Image decoded once**: previously each built-in provider re-parsed the S-record. The `image`
  capability removes that duplication and makes non-text containers (bin/ELF) a pure adapter.
- **Symbols as a port**: business names are no longer tied to "this text is arxml". Any source
  that can produce `id → name` lights up block naming across all layout tiers.
- **Core stays vendor-blind**: the regex gate (`FeeV3|feeLcfg|Fee_Lcfg|MICROSAR|vectorFeeV3|link
  table|link-table` = 0 hits in both bundles) still holds — vendor knowledge is in adapters and
  engine packs, not the core boundary.
