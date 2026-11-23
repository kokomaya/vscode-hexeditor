# OS / EcuM 类复位

覆盖：`FS_RESET_OS_*`、`FS_RESET_ECUM_REQUEST`、`FS_RESET_GUARD_VIOLATION`。

- `FS_RESET_OS_SERVICE_FAILED`：`FS_ApplMon.c` / `FS_Daemon.c`，无上下文（部分版本才有）。
- `FS_RESET_OS_KERNEL_PANIC` / `_ERROR_HOOK_CALLED` / `_SHUTDOWN`：OS 层。
  `e_SharedInfoID = OS` → `Shared.Os = { u_TaskModuleName, u_TaskLineNumber, u_OsErrorNumber, u_OsErrorDetails }`；
  `= OSEXT` → `Shared.OsState = { a_TaskName, u_InstrAddress, u_MachineState, u_StackPointer, a_OtherRegs, a_CallStack }`。
- `FS_RESET_ECUM_REQUEST`：EcuM 请求复位（软件主动，但不是 `INTENTIONAL_RESET`）。
- `FS_RESET_GUARD_VIOLATION`：RAM / 外设保护违规。

TODO：OS 错误号表；`u_TaskModuleName` 的编码方式。
