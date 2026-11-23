# DSP / DPU 类复位（FS_RESET_DSP_* / FS_RESET_DPU_*）

- `FS_RESET_DSP_FATAL_ERROR`：`FS_DpuHeartBeat.c` 的 `FS_DpuHeartBeat_v_Cat2Reaction(faultCode, dbgInfo, coreNum)`，
  故障码如 `FS_DPUHEARTBEAT_ERR_INIT_ORDER`、`ERR_SLAVE_INITIAL_TIMEOUT`、`ERR_SLAVE_TASK_TIMING_FAULT`。
  上下文 `FS_DpuHeartBeat_a_ContextData`：TODO（故障码 / 调试信息 / 核号的字节布局）。
- `FS_RESET_DPU_SS_CRC_FAILURE` / `_SHARED_MEM_FAILURE`：DPU 传来的 SafeSection CRC 错误 / 共享内存指针异常。
- `FS_RESET_DPU_RESET_REQUEST`（部分版本才有）：DPU 请求复位，`Cat2Reaction` 不改写 SafeSection。
- 远端（DPU）SafeSection 可经 `FS_SafeSection_v_MergeIntoRamData` 合并进本地记录：此时 `u_CycleCounter`、
  `u_ResetCounter`、`u_Index` 等保留本地值，其余字段来自远端；远端 CRC 不符则状态为 `INVALID`。
