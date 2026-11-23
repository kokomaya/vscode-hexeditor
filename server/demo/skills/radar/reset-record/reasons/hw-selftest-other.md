# 硬件自检及其它复位

本文件是 `valueDocs` 的兜底（`"*"`），覆盖未单独归类的原因：

- 处理器自检：`FS_RESET_ALU_CHECK`、`FPU_CHECK`、`SPE_CHECK`、`SIMD_CHECK`、`CPU_REGISTER_CHECK`、
  `CONFIG_REGISTER_CHECK`、`LOCKSTEP_*`、`BIST_FAILED`、`LOGIC / MEMORY_BIST_FAILED`、`STCU_RESET`、`ADC_SELFTEST_FAILED`
  —— 触发模块 `FS_AluTest.c`、`FS_FpuTest.c`、`FS_SimdTest.c`、`FS_CpuReg.c`、`FS_ConfigReg*.c`、`FS_LockStep.c`、`FS_Stcu.c`。
- 初始化 / 配置：`FS_RESET_MPU_INIT_FAILED`、`PMC_INIT_FAILED`、`STARTUP_SEQUENCE_FAULT`、`TESTCASE_ABORT / CONFIG`（`FS_Master.c`）。
- 外设 / 通信：`FS_RESET_IOHWAB*`、`CSI2_*`、`ITC_BUFFER_BLOCKED`、`IPC_SPI_SET_MODE_ERROR`、`DGM_NO_REACTION`、
  `SID_RESET`、`SECURITY_FAULT`。
- Bootloader：`FS_RESET_BL_*`；客户定义：`FS_RESET_CUSTOMER_*`。

某类原因经常出现时，建议拆出单独文档，并在 `SKILL.md` 的 `valueDocs` 中放到 `"*"` 之前。
