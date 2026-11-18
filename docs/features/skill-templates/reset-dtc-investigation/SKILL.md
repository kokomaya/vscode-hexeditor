---
name: reset-dtc-investigation
kind: playbook
description: >
  排查"复位与故障码之间的关系"：复位是否在 DEM 中留下 CAT1/CAT2 事件，DTC 是否先于复位出现（可能是 DTC 引起复位），
  两者的时序与一致性。
keywords: [reset, DTC, 复位, 故障码, 关系, 时序, 根因, cat2, cat1, DEM]
uses: [ecu-reset-counter, dem-event-memory, write-timeline, cross-block-consistency]
tools: [nvm_checkRules, nvm_queryFields, nvm_timeline, nvm_correlateWrites, nvm_evaluate]
---

## 背景（来自 FS_Reset_v_ReportErrorResetToDem）

非主动、非上电的复位在下次启动时上报 DEM：`FS_MON_CAT1_ERROR_RESET`（UNEXPECTED_RESET）、
`FS_MON_CAT2_IUC_INTERNAL`（class 2）、`FS_MON_CAT2_IUC_EXTERNAL`（class 3）、`FS_MON_CAT2_SW_RELATED`（其余），
温度 / 电池类映射到欠温 / 过温、低压 / 高压事件。pre-extended data = `[reason 高, reason 低, 上下文 8 字节]`，
事件随即置为 passed。见 `ecu-reset-counter` 的 `reasons/encoding-and-classes.md`。

## 步骤（TODO 按项目确认 DEM 事件名 / block 名）

1. `nvm_checkRules({ skills: ["reset-dtc-investigation"] })` —— 同时评估 `ecu-reset-counter` 与 `dem-event-memory`
   中声明的 rules / relations。
2. 复位清单：`nvm_queryFields({ blocks: "Nvm_SafeSection_Data_Record*", fields: ["u_Index", "FsData.e_ResetReason", "FsData.u_CycleCounter", "FsData.u_SwVersion"] })`，
   按 `u_Index` 由新到旧排序；用 `FsData.e_ResetReason >> 14` 得到等级，推出应出现的 DEM 事件。
3. 在 DEM 中查对应事件：`nvm_searchBlocks("FS_MON_CAT")`，或
   `nvm_queryFields({ blocks: "DemPrimaryDataBlock*", fields: ["EventId"], where: "contains(label(EventId), 'FS_MON_CAT')" })`。
4. 时序：`nvm_timeline({ around: "Nvm_SafeSection_Data_Record<n>", window: 10 })`；
   `nvm_correlateWrites({ a: "Nvm_SafeSection_Data_Record*", b: "DemPrimaryDataBlock*", within: 5 })` ——
   `bBefore` 多表示 DEM 写入早于复位记录（DTC 可能是原因），`bAfter` 多表示复位后上报。
5. 业务假设验证（`nvm_evaluate`），例如：同一次复位的 DEM pre-extended data 的前两字节应等于 `e_ResetReason`。

## 回答格式

- 复位次数（保留的记录数）与原因 / 等级分布
- 每次复位对应的 DEM 事件是否存在、时序关系（证据：sequence、u_Index）
- 失败的规则 / 关系
- 结论与置信度；需要补充的知识（TODO）
