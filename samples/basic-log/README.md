# Sample NVM dump (synthetic)

Vendor-neutral practice data for NVM Studio — **no real project data**.

| File | Purpose |
| --- | --- |
| `sample-nvm.mot` | S-record image of a sequential NVM log: 4 logical blocks (ids 0x10, 0x20, 0x30, 0x40) rewritten over time; one write has a corrupted CRC |
| `sample.nvmlayout.json` | Structured (T1) descriptor: header `id/len/ver/stat`, payload `$len`, CRC16-CCITT-FALSE trailer, 8-byte alignment |
| `write-history.nvmworkbench.json` | Scenario workbench layout, auto-selected for this dump |

Regenerate the image: `npx esbuild tools/makeSampleDump.ts --bundle --platform=node --outfile=out/makeSample.js && node out/makeSample.js samples/basic-log/sample-nvm.mot`
