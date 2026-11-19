# Open a dump

NVM Studio opens S-record and Intel HEX dumps (`.mot`, `.s19`, `.srec`, `.hex`, …).

- **No project data at hand?** Open the built-in *sample dump*: a small, synthetic
  sequential log with four logical blocks rewritten over time — and one block whose
  CRC does not match.
- **Your own dump:** NVM Studio recognizes it when a `*.nvmlayout.json` descriptor
  sits next to it, in `./conf` or in `../conf`. Without one, the file is shown as plain hex.
