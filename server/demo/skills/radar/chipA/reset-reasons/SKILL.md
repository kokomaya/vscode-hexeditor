---
name: reset-reasons
kind: playbook
description: >
  chipA platform: how to read reset reasons on any chipA radar project. Use when the user asks why the ECU reset.
keywords: [reset, 复位, reset reason, chipA]
---

## Steps
1. Find the `ResetCounter` block and its latest write.
2. Payload bytes 0..3 = counter (u32 LE), byte 4 = reason code.
3. Reason codes on chipA: 1 = power-on, 2 = watchdog, 4 = software reset.
4. Compare the counter between writes to count resets in this dump.
