---
name: reset-exception-analysis
kind: playbook
description: >
  深入分析处理器异常导致的复位（FS_RESET_EXCEPTION / FS_RESET_EXCEPT_*）：用寄存器快照、调用栈和 map 文件
  定位出错函数，判断是确定性软件缺陷还是硬件/内存问题。
keywords: [exception, 异常, data abort, prefetch abort, 浮点, FPU, PC, 调用栈, call stack, map, 地址, 崩溃]
uses: [reset-record, write-timeline]
tools: [nvm_queryFields, nvm_getDecoded, nvm_blockHistory, nvm_evaluate, nvm_readSkillResource]
---

## 前提

- 先 `nvm_useSkill("reset-record")`，并读取 `reasons/exception.md`（字段含义、平台异常号）。
- 地址解析需要与 dump 对应软件版本的 `*.map` 文件（demo 目录下：`ars620cn15_ars620_s2a2_2can_iuc.map`、
  `..._dpu_arm_m4.map`、`..._dpu_dsp_c66.map`）。TODO：按 `FsData.u_CoreNumber` 选择对应核的 map。

## 步骤

1. 列出所有异常类记录：
   `nvm_queryFields({ blocks: "Nvm_SafeSection_Data_Record*", fields: ["u_Index", "FsData.e_ResetReason", "FsData.e_SharedInfoID", "FsData.Shared.Mcu.u_ExceptionID", "FsData.Shared.Mcu.u_InstrAddress", "FsData.Shared.Mcu.u_DataAddress", "FsData.a_ResetContextData[]", "FsData.u_SwVersion"], where: "glob(label(FsData.e_ResetReason), 'FS_RESET_EXCEPT*')" })`
2. 每条记录取出代码地址：
   - `FS_RESET_EXCEPTION` 且 `e_SharedInfoID == MCU` → `Shared.Mcu.u_InstrAddress` 和 `Shared.Mcu.a_CallStack[]`
   - `FS_RESET_EXCEPT_FLOATING_POINT` → `a_ResetContextData[4..7]` 为 FPU 异常指令地址，`[0..3]` 为错误标志。
     上下文按 **MSB 在前（大端）** 写入（`FS_Master_v_SetContextInfo`），例如
     `nvm_evaluate({ blocks: "Nvm_SafeSection_Data_Record*", expr: "FsData.a_ResetContextData[4]*16777216 + FsData.a_ResetContextData[5]*65536 + FsData.a_ResetContextData[6]*256 + FsData.a_ResetContextData[7]" })`
3. 在 map 文件中查找"不大于该地址的最近符号"，得到函数名 + 偏移。（TODO：若后续提供 map 解析工具，在此替换为工具调用。）
4. 判断模式：
   - 多条记录同一函数 / 同一 PC → 确定性软件缺陷，给出函数与调用链；
   - PC 分散、`u_DataAddress` 指向 RAM 随机位置 → 怀疑内存损坏，转查 `reasons/memory.md`、电压 / 温度记录；
   - 只出现在某个 `u_SwVersion` → 版本回归。
5. 时序：`nvm_timeline({ around: "<该记录>", window: 10 })` 看复位前后写入的其它 block（例如 DEM 条目）。

## 回答格式

- 每条异常：原因、异常类型、PC → 函数、调用链（若有）、软件版本、运行时间（`u_CycleCounter`）
- 结论：缺陷类型判断 + 置信度
- 缺失信息：map 版本不匹配、`e_SharedInfoID` 与原因不符等
