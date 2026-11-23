# 意外 / 外部 / 破坏性复位

- `FS_RESET_UNEXPECTED_RESET`（class 3）：复位前**没有**经过 `FS_Reset_v_Cat2Reaction`（例如 CAT1 硬件复位、
  掉电、未被软件捕获的故障）。`FS_SafeSection_v_Init` 把 RAM 中的默认原因设为它；启动时
  `FS_Reset_v_StartUpTest` 会尝试从硬件寄存器读出真实原因（`Pal_Reset_e_GetResetReason`，同时填充上下文）。
  记录中仍是 UNEXPECTED，表示硬件也给不出原因。DEM：`FS_MON_CAT1_ERROR_RESET`。
- `FS_RESET_EXTERNAL_RESET`（class 3）：外部复位引脚。
- `FS_RESET_DESTRUCTIVE_RESET`（class 2）：软件引起的破坏性复位。

排查：同一时间段是否有 ATIC 记录（外部看门狗 / 电源）或电压类记录；`u_CycleCounter` 是否为 0（复位前没有运行）。
