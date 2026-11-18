---
name: dem-event-memory
kind: block
description: >
  TODO DEM 事件存储（DTC、状态字节、冻结帧、老化计数）。用户问某个 DTC 的状态、出现次数、冻结帧、老化时使用。
keywords: [DTC, 故障码, 事件, event memory, freeze frame, 冻结帧, aging, 老化, status, TODO]
appliesTo:
  blocks: ["TODO_DemPrimaryDataBlock*"]
  # layout: "*"
# struct: dem.struct.json        # engine 已解码时可以不写，只写 fields 释义
# structRoot: TODO_DemEntry_t
fields:
  TODO_EventId:     { meaning: "TODO DEM 事件 ID（对应 DTC）" }
  TODO_StatusByte:  { meaning: "TODO UDS DTC 状态字节（bit0 testFailed … bit7 warningIndicatorRequested）" }
  TODO_AgingCounter: { meaning: "TODO 老化计数，达到阈值后条目被清除", unit: "cycle" }
  TODO_OccurrenceCounter: { meaning: "TODO 发生次数", unit: "count" }
rules:
  - id: confirmed-has-freeze-frame
    expr: "!(bit(TODO_StatusByte, 3) == 1) || exists(TODO_FreezeFrame[])"
    severity: warning
    message: "TODO confirmed 的 DTC 应有冻结帧"
relations:
  - id: admin-cowritten
    kind: cowrite
    with: "TODO_DemAdminDataBlock*"
    within: 3
    meaning: "TODO 每次写事件存储都应伴随写管理数据（occurrence order）"
  - id: admin-present
    kind: presence
    with: "TODO_DemAdminDataBlock*"
    expect: present
  # - id: event-id-known
  #   kind: reference
  #   field: TODO_EventId
  #   with: "TODO_EventConfig*"
---

## 这是什么
TODO DEM primary memory 的条目；每条对应一个事件槽位。

## 如何回答常见问题
- "DTC X 的状态" → `nvm_searchBlocks` 按 EventId 找到条目，读 `TODO_StatusByte` 并按位解释。
- "出现过几次" → `TODO_OccurrenceCounter`。
- "什么时候第一次出现" → `nvm_blockHistory` 找到首次出现该 EventId 的版本 sequence。

## 注意
- TODO 槽位复用：同一槽位不同版本可能是不同事件。
