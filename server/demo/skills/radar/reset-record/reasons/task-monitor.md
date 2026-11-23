# 任务监控类复位（FS_RESET_TASK_* / FS_RESET_CHECKPOINT_* / FS_RESET_MONITOR_INTERVAL_TIME）

- 触发：`FS_Task.c`（`FS_Reset_v_Cat2Reaction(e_ResetReason, a_ContextData)`）。
- 上下文：`a_ResetContextData[0..3]` = 任务 ID（`u_TaskId`），`[4..7]` = 附加参数（`u_Param`，随原因不同），均为大端 u32。
- `e_SharedInfoID = TASK` 时 `Shared.Task` 有效：`u_ComponentId`、`u_TaskCount`、
  `a_Tasks[i] = { u_CodeSeqId, u_MinTaskTime, u_MaxTaskTime }`（最多 `FS_SAFE_SECTION_NUMBER_OF_TASKS` 个）。
- `FS_RESET_TASK_BAD_CONFIG`：配置错误，无上下文。

排查：用 `u_TaskId` 找到任务；看 `u_MaxTaskTime` 是否超出配置；`CHECKPOINT_SEQUENCE / MISSING` 表示控制流被打断。
TODO：任务 ID → 任务名映射表；`u_Param` 在各原因下的含义。
