# 上电 / 主动复位 / 无复位

- `FS_RESET_NONE`：SafeSection 尚未初始化；`FS_RESET_POWER_ON`：上电；`FS_RESET_INTENTIONAL_RESET`：软件主动复位
  （`FS_Reset_v_SoftReset` / `FastReset` / `Reboot`，例如刷写、诊断复位）。
- 这三类**按设计不会写入 NvM 记录**。若在 `Nvm_SafeSection_Data_Record*` 中出现，说明 layout 错位（先用 CRC 校验确认），
  或记录来自不同的软件实现。
- RAM 中上一次的复位原因可通过诊断接口读取，不在本 dump 范围内。
