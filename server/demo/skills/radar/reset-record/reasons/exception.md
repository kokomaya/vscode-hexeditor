# 处理器异常类复位（FS_RESET_EXCEPTION / FS_RESET_EXCEPT_*）

| 原因 | 触发点（参考实现） | 现场数据 |
|------|------------------|---------|
| `FS_RESET_EXCEPTION` | `Pal_Exception_v_ErrorReaction`（各平台 `PAL_Exceptions.c`） | `Shared.Mcu`，`e_SharedInfoID = MCU` |
| `FS_RESET_EXCEPT_FLOATING_POINT` | `Pal_Exception_v_FpuErrorIsr` | `a_ResetContextData[0..3]` = FPU 错误标志，`[4..7]` = FPU 异常指令地址（均为大端 u32） |
| `FS_RESET_EXCEPT_UNEXPECTED_IRQ` | `FS_Exceptions.c`（未注册中断） | 无上下文 |
| `FS_RESET_EXCEPT_UNEXPECTED_NMI` / `_UNDEFINED` / `_RECURSION` / `_CORE_FREEZE` | 平台异常处理 | TODO 按平台补充 |

## Shared.Mcu 字段（以 tir5f 平台为例，TODO 确认本 ECU 平台）

- `u_ExceptionID`：`PAL_EXCEPTION_ID_*` —— 0 RESET，1 UNHANDLED，2 SYSCALL，3 PREFETCH_ABORT，4 DATA_ABORT，
  5 UNHANDLED，6 IRQ，7 FIQ。
- `u_ExceptFlags` = 故障状态寄存器；`u_MachineState` = PSR；`u_InstrAddress` = PC；`u_DataAddress` = 故障地址；
  `a_OtherRegs[0]` = 当前任务；`u_StackPointer` = SP；`a_CallStack[]` = 基于帧指针回溯的返回地址。

## 读这条记录时注意

- 先确认 `e_SharedInfoID == MCU`；否则寄存器数据不属于本次复位（可能是残留）。
- DATA_ABORT：结合 `u_DataAddress` 判断空指针 / 越界 / 访问受保护外设。

要把地址解析成函数、判断是软件缺陷还是内存 / 硬件问题、或对比软件版本，按 playbook
`nvm_useSkill("reset-exception-analysis")` 的步骤做（map 文件定位、同一 PC 模式、版本回归、时序）。

TODO：本项目平台的异常号定义、FPU 错误标志位含义。
