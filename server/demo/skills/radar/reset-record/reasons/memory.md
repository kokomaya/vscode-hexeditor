# 内存类复位（ECC / RAM 奇偶校验 / 地址总线 / 内存测试）

覆盖：`FS_RESET_ECC_*`、`FS_RESET_RAM_PARITY_ERROR`、`FS_RESET_ADDRESS_BUS_*`、`FS_RESET_ADDRESS_TEST_TIMEOUT`、`FS_RESET_MEMTEST`。

- 触发：`FS_Ecc.c`（原因随存储区域而定：FLASH / EEPROM / SRAM / TCM / Cache / DMA / CAN / CSI…）、
  `FS_AddressBus.c`。等级多为 2（IUC 内部）→ DEM `FS_MON_CAT2_IUC_INTERNAL`。
- 上下文：TODO（多为出错地址 / 区域标识，见各 `*_v_Cat2Reaction` 调用处的 `a_ContextData`）。

排查：同一地址反复出错 → 硬件缺陷；随机分布 → 电源 / 温度 / 辐射。结合 `voltage-temperature.md` 中的记录和时间线。
