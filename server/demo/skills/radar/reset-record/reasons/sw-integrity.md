# 软件完整性 / 兼容性类复位

覆盖：`FS_RESET_APPL_INFOBLOCK`、`FS_RESET_APPL_CRC_CHECK`、`FS_RESET_XPAR_CRC_CHECK`、`FS_RESET_XPAR_MISSING`、
`FS_RESET_HW_SW_INCOMPATIBLE`、`FS_RESET_RFCOM_INCOMPATIBLE`。

- 触发：`FS_AppSwCrcTest.c`（应用代码 / XPAR 参数 CRC、info block 校验）。上下文：TODO。
- 常见场景：刷写不完整、参数块缺失、软硬件版本不匹配。对比 `FsData.u_SwVersion` 与刷写记录。
