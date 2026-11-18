# FCCU 类复位（FS_RESET_FCCU_*）

- 触发：`FS_Fccu.c`（`CORRUPTED_CONFIG`、`NOT_INITIALIZED`，无上下文）；平台 `PAL_Fccu.c` 写
  `e_SharedInfoID = FCCU`，`Shared.Fccu.a_FaultFlags[]` = 各故障通道状态（`FS_SAFE_SECTION_NUMBER_OF_FCCU_FAULTS` 个）。
- `FS_RESET_FCCU_FAULT_SIGNALED`：FCCU 检测到硬件故障 —— 用 `a_FaultFlags` 中置位的位定位故障源（TODO 位定义表）。
