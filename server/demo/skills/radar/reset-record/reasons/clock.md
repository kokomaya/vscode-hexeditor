# 时钟监控类复位（FS_RESET_CLKMON_*）

- 触发：`FS_ClockMon.c`、`FS_ClockMonSuspend.c`（`FS_RESET_CLKMON_SUSPEND_TIMEOUT`）。等级 2。
- 上下文：TODO（见 `FS_ClockMon*` 中的 `a_ContextData`）。
- 含义：PLL 失锁、监控挂起过久、初始化 / 配置校验失败、校准失败、频率超范围、自检失败。

排查：是否伴随电压 / 温度异常（`voltage-temperature.md`）；是否只出现在启动阶段（`u_CycleCounter` 很小）。
