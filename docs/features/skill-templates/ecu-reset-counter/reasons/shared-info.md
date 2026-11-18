# FsData.Shared —— 哪个成员有效

`e_SharedInfoID` 决定联合体 `FS_SafeSection_t_SharedInfo` 中哪个成员有意义（解码器只展开该成员；`NONE` 不展开）。
**编号随 FS 版本不同**，本 demo 使用 MAP_VERSION 15：

| ID | MAP 15 枚举 | 成员 | 由谁写入（参考实现） | 说明文档 |
|----|------------|------|--------------------|---------|
| 0 | `FS_SHARED_INFO_NONE` | — | — | 无共享数据 |
| 1 | `FS_SHARED_INFO_MCU` | `Mcu` | `PAL_Exceptions.c` | exception.md |
| 2 | `FS_SHARED_INFO_TASK` | `Task` | `FS_Task.c` | task-monitor.md |
| 3 | `FS_SHARED_INFO_OS` | `Os` | OS 层（TODO） | os-ecum.md |
| 4 | `FS_SHARED_INFO_VOLTAGE` | `Voltage` | `FS_Voltage.c` | voltage-temperature.md |
| 5 | `FS_SHARED_INFO_OSEXT` | `OsState` | OS 层（TODO） | os-ecum.md |
| 6 | `FS_SHARED_INFO_FCCU` | `Fccu` | `PAL_Fccu.c` | fccu.md |
| 7 | `FS_SHARED_INFO_STACK` | `Stacks` | `FS_Stack.c` | stack.md |
| 8 | `FS_SHARED_INFO_PMIC` | `Pmic` | `PAL_Atic.c`（tda4_r5f） | atic-pmic.md |

MAP_VERSION 16 的差异：7 = `STACK_1`（`Stacks1`）、8 = `STACK_2`（`Stacks2`，新增 `FS_Stack2.c`）、9 = `PMIC`。
用错版本的头文件时，7/8 号会被展开成错误的成员——先看 `u_MapVersion`。

注意：

- Shared 区在启动时（`FS_SafeSection_v_Init`）清零，`FS_SafeSection_v_ClearSharedSection` 也会清零；
  若 `e_SharedInfoID` 与复位原因不相关（例如 FPU 异常却带 MCU 快照），先确认快照是否属于本次复位。
- 联合体大小由 `FS_SafeSection_Prv.h` 决定（本 demo：80 字节，记录总长 144 字节，CRC 已核对）。
