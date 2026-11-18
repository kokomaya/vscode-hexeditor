# 看门狗类复位（FS_RESET_WATCHDOG* / FS_RESET_STARTUP_TIME_EXCEEDED）

| 原因 | 触发点（参考实现） | 上下文 |
|------|------------------|-------|
| `FS_RESET_WATCHDOG_NOT_TRIGGERED` | `FS_Wdg.c` | `[0]` = 触发条件 `u_TriggerCondition`，`[1]` = 阶段 `e_PhaseID` |
| `FS_RESET_STARTUP_TIME_EXCEEDED` | `FS_Wdg.c` | 同上 |
| `FS_RESET_WATCHDOG` | 窗口看门狗超时 / 窗口外触发（多由硬件报告，启动时经 `Pal_Reset_e_GetResetReason` 得到） | 由平台填充 |
| `FS_RESET_WATCHDOG_SELFTEST` / `_INIT_FAILED` | 看门狗自检 / 初始化 | TODO |

- 看门狗**自检**过程中产生的 `FS_RESET_WATCHDOG` 不写 SafeSection（`FS_Wdg_b_IsTestRunning`）。
- `FsData.u_WdogTestStep` / `u_WdogErrFlags` 跨复位保留，可看出自检进行到哪一步。
- 外部看门狗（ATIC）见 `atic-pmic.md`。

排查：结合 `u_CycleCounter`（运行多久后复位）与同期写入（`nvm_timeline({ around: "<记录名>" })`）判断是任务阻塞、
中断风暴还是启动过慢。TODO：`e_PhaseID` 取值表。
