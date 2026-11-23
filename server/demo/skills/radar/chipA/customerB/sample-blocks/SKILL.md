---
name: sample-blocks
kind: block
description: >
  customerB: meaning of the ResetCounter / DtcMemory / Calibration / Odometer blocks. Use when the user asks about these blocks.
keywords: [reset, DTC, calibration, odometer, 里程, 复位]
appliesTo:
  blocks: ["ResetCounter", "DtcMemory", "Calibration", "Odometer"]
---

## Blocks
- **ResetCounter** — u32 reset count + u8 reason (see the chipA `reset-reasons` playbook).
- **DtcMemory** — u32 DTC code, u8 occurrence counter, u8 UDS status byte.
- **Calibration** — 16 bytes of calibration data; a CRC mismatch means an interrupted write.
- **Odometer** — u32 kilometres; must never decrease between writes.
