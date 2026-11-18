# NVM AI capabilities (the Copilot boundary)

The plugin exposes its NVM knowledge to GitHub Copilot (and any agent using the VS Code
**Language Model Tools** API) through **one vendor-blind facade**:
[`src/nvm/ai/nvmCapabilities.ts`](../src/nvm/ai/nvmCapabilities.ts) → class `NvmCapabilities`.

Everything AI-facing goes through it:

- the five (now nine) **Language Model Tools** in [`src/nvm/ai/lmTools.ts`](../src/nvm/ai/lmTools.ts)
  (referenceable in any Copilot prompt with `#nvm…`), and
- the **`@nvm` chat participant** in [`src/nvm/ai/chatParticipant.ts`](../src/nvm/ai/chatParticipant.ts).

## Design rules (SOLID + vendor/user-free)

- **One capping seam (SRP/DRY).** *All* paging, hard caps, truncation and write guardrails live
  in `NvmCapabilities`. A single tool call can never dump a huge file into the model context.
  The tool layer only validates input and renders the returned structured data as text.
- **DIP.** Tools and chat depend on the `NvmCapabilities` abstraction, not on
  `HexEditorRegistry` / `AnnotationService` directly. `extension.ts` builds one facade instance
  and injects it into both.
- **OCP.** A new capability = one method on the facade + one thin tool registration; existing
  tools are untouched.
- **vendor-free / user-free.** The facade returns only generic block geometry, the generic
  decoded tree, raw bytes, and the user's own annotations. It **never** explains what a block
  *means* — names come from symbol adapters, meaning from user notes; both live outside it.

## The capability catalog

Each capability is a facade method; most are surfaced 1:1 as an LM tool. `Page<T>` =
`{ items, total, returned, offset, hasMore }` so the model can tell it should page for more
instead of assuming it saw everything.

| Facade method | LM tool (`#ref`) | Input | Returns | Read limit |
|---|---|---|---|---|
| `listBlocks` | `#nvmListBlocks` | `{limit?, offset?}` | `Page<BlockSummary>` | default 100, **hard cap 500** |
| `searchBlocks` | `#nvmSearchBlocks` | `{query, limit?, offset?}` | `Page<BlockSummary>` | same |
| `analyzeBlock` | `#nvmAnalyzeBlock` | `{name}` | `BlockDetail` | fields ≤ **200**; `raw` JSON ≤ **2000 chars** |
| `getDecoded` | `#nvmGetDecoded` | `{name, maxDepth?, maxNodes?}` | `DecodedSummary` | depth ≤ 4, nodes ≤ 300 (defaults; capped) |
| `readBytes` | `#nvmReadBytes` | `{offset, length}` | `BytesWindow` (hex) | length **hard cap 4096 B** |
| `listAnnotations` | `#nvmListAnnotations` | – | `AnnotationsSummary` | each list ≤ **200**; note bodies omitted |
| `createNote` | `#nvmCreateNote` | see guardrails | `CreateNoteResult` | **write** — one note per call |
| `exportReport` | `#nvmExportReport` | – | `{markdown, truncated}` | ≤ **40000 chars** |
| `riskDetection` | `#nvmRiskDetection` | – | `{risks[]}` | bounded by heuristic count |

`query` in `searchBlocks` matches a case-insensitive substring of the block name/id, **or** a
byte offset (`0x..` or decimal) that falls inside a block — so `#nvmSearchBlocks 0x1A40` finds
the block covering that byte.

### Ownership: what is plugin data vs user/vendor data

| Owned by the **plugin** (pure data the facade returns) | Owned by **user / vendor** (never invented by the facade) |
|---|---|
| block id, offset, length, field geometry | what a block *represents* / its business semantics |
| the decoded field tree (shape + physical values) | struct definitions & names (from vendor engine / symbol adapters) |
| raw bytes | interpretation of those bytes |
| the user's bookmarks / tags / notes | the meaning the user wrote into notes |

## The one write path — `createNote` guardrails

Note creation is the only capability that mutates the dump, so it is deliberately hard to abuse
(no whole-file "note spam"). All three checks are enforced **inside the facade**:

1. **Must be anchored.** The note targets a named block's byte range (`blockName`) **or** an
   explicit `start`/`end` range. Neither → the call is rejected.
2. **Must have a title and body.** Empty/whitespace title or body → rejected. Placeholder notes
   never persist.
3. **User confirms before write.** Confirmation uses VS Code's **native tool-confirmation UI**,
   not a modal: the `nvm_createNote` tool implements `prepareInvocation`, returning
   `confirmationMessages { title, message }` that names the note and byte range and previews the
   body. VS Code shows this before `invoke()` runs, and the user may choose "Always Allow". The
   facade's `createNote` therefore no longer prompts; validation is shared via
   `validateNoteInput` (called from both `prepareInvocation` and `createNote`). A modal
   `confirmFallback` remains in the facade only for hosts that cannot show a tool confirmation,
   so an AI note is never written completely unconfirmed.

On success the note is persisted via `AnnotationService.apply(uri, {kind:"addNote", …, body})`
(the protocol's `addNote` command carries an optional `body` so AI-authored text is stored
verbatim; without a body the human template is used, preserving existing behavior).

## Loose typing & no-op fallback

The Chat and LM Tools APIs postdate this fork's `@types/vscode` baseline, so both are accessed
through local interface shims and runtime feature-detection (`getLmApi`, `getChatApi`,
`textResult`). On a host without the API, `registerLmTools` / `registerChatParticipant` simply
return `[]` — nothing registers and nothing breaks.

## Extending

Add a capability:

1. Add a method to `NvmCapabilities` that returns a **structured** value and enforces its own cap.
2. Register a thin tool in `lmTools.ts` that validates input, calls the method, formats text.
3. Declare it in `package.json` under `contributes.languageModelTools` (with an `inputSchema`).
4. Document it in the table above.

Do **not** add capping or data-access logic to the tool layer, and do **not** teach the facade
what any block means — that stays with adapters and user notes.
