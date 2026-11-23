# ATIC / PMIC 类复位（FS_RESET_ATIC_*）

- ATIC（外部安全芯片 / PMIC）引起的复位在**启动时**由 ATIC 模块识别并直接写 NvM
  （`FS_RESET_FLAG_SAFESECTION_NVM_ATIC`），不经过 `FS_Reset_v_Cat2Reaction`。
- demo dump 中这类记录：`e_SectionState = FREE`、`e_SharedInfoID = NONE`（无 Shared 数据），属正常现象。TODO 结合 `FS_Atic.c` 确认。
- 部分平台（`PAL_Atic.c`，tda4_r5f）写 `e_SharedInfoID = PMIC`（MAP 15 为 8，MAP 16 为 9）：`Shared.Pmic = { u_DeviceID, u_RegCount, u_ErrFlags, a_StatusRegs[] }`。

| 原因 | 等级 | 说明 |
|------|-----|------|
| `FS_RESET_ATIC_WATCHDOG` | 3 | 外部看门狗未被正确喂狗 —— MCU 侧可能已卡死，MCU 内部现场通常缺失 |
| `FS_RESET_ATIC_VOLTAGE` | 3 | ATIC 电压调节器故障 |
| `FS_RESET_ATIC_TEMPERATURE_INT` | 3 | ATIC 内部过温 |
| `FS_RESET_ATIC_OVER_TEMP_EXT` / `_UNDER_TEMP_EXT` | 0 | PCB 过温 / 欠温（DEM 报温度事件） |
| `FS_RESET_ATIC_READ_ERROR` | 2 | ATIC 寄存器读取失败 |
| `FS_RESET_ATIC_OTHERS` | 3 | 其它 |

排查：ATIC_WATCHDOG 前后是否有 MCU 侧记录（异常、看门狗）；`u_CycleCounter` 是否集中在某个运行时长。
