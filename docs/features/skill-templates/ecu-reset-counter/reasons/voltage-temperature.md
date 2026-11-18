# 电压 / 温度类复位

覆盖：`FS_RESET_UBATT_*`、`FS_RESET_TEMP_*`、`FS_RESET_MCU_SUPPLY / VOLTAGE_* / TEMPERATURE`、`FS_RESET_VOLTAGE_*`、
`FS_RESET_NTC_TEMP_INVALID`、`FS_RESET_MMIC_TEMPERATURE`、`FS_RESET_SOC_TEMPERATURE`、`FS_RESET_STARTUP_CONDITION`。

- 触发：`FS_Voltage.c`（`FS_Voltage_v_Cat2Reaction`，原因来自监控配置 `p_MonConfig[i].e_ResetReason`）、`FS_StartupCond.c`。
- `e_SharedInfoID = VOLTAGE` 时 `Shared.Voltage`：`a_Voltages[]`（各通道电压，sint16，TODO 单位 / 通道表）、
  `u_EnableFlags`、`u_FaultFlags`（哪一路超限）。
- 上下文：`a_ResetContextData[1]` = `FS_VOLTAGE_TOO_LOW` / 过高，用于 `TEMP_OUT_OF_RANGE`、`UBATT_OUT_OF_RANGE`
  的 DEM 事件选择（欠温 / 过温、低压 / 高压）。其余字节 TODO。
- `UBATT_OUT_OF_RANGE`、`TEMP_OUT_OF_RANGE` 等级 0（环境原因，非 ECU 缺陷）。

排查：用 `u_FaultFlags` 定位通道 → `a_Voltages[通道]`；多次复位是否同一工况（`u_CycleCounter`、软件版本）。
