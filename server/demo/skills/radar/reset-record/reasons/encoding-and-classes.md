# 复位原因编码、等级与存储流程

> 依据：参考实现 `adas_embed_mon/lib-src/st/generic/FS_Reset_Pkg/FS_Reset.c|.h`、
> `FS_SafeSection_Pkg/FS_SafeSection.c`。函数名可直接在源码中检索。

## 编码

`e_ResetReason = RESET_REASON(number, class)`（16 bit 有效）：

- bit 0..13：原因号（`FS_RESET_REASON_MASK = 0x3FFF`）
- bit 14..15：等级（`FS_RESET_REASON_CLASS(n) = (n & 0xC000) >> 14`）

| class | 宏 | 含义 | 上报 DEM 事件（`FS_Reset_v_ReportErrorResetToDem`） |
|------|----|------|-----------------------------------------------------|
| 0 | `FS_RESET_CLASS_UNCRITICAL` | 非关键（上电、主动复位、PCB 过/欠温…） | 温度/电池类单独映射，其余不报 |
| 1 | `FS_RESET_CLASS_SW_RELATED` | 软件问题 | `FS_MON_CAT2_SW_RELATED` |
| 2 | `FS_RESET_CLASS_IUC_INTERNAL` | 处理器内部硬件问题 | `FS_MON_CAT2_IUC_INTERNAL` |
| 3 | `FS_RESET_CLASS_IUC_EXTERNAL` | 处理器外部硬件问题 | `FS_MON_CAT2_IUC_EXTERNAL` |

特例：`FS_RESET_UNEXPECTED_RESET` → `FS_MON_CAT1_ERROR_RESET`；`FS_RESET_TEMP_OUT_OF_RANGE` /
`FS_RESET_UBATT_OUT_OF_RANGE` 依据 `a_ResetContextData[1]`（过低/过高）映射到欠温/过温、低压/高压事件；
`FS_RESET_ATIC_OVER/UNDER_TEMP_EXT` → 过温/欠温事件。DEM 事件的 pre-extended data =
`[reason 高字节, reason 低字节, a_ResetContextData[0..7]]`，随后事件被置为 passed（被动事件）。

快速换算：`16394 = 0x400A` → class 1、原因号 10（EXCEPTION）；`49262 = 0xC06E` → class 3、原因号 110（ATIC_WATCHDOG）。
表达式：`FsData.e_ResetReason >> 14`（等级）、`FsData.e_ResetReason & 0x3FFF`（原因号）。

## 上下文字节 a_ResetContextData[0..7]

多数模块用 `FS_Master_v_SetContextInfo(buf, value, size)` 填写：**MSB 在前（大端）**，超出 `size` 字节能表示的值会被
**饱和**为最大值。常见布局是两个 u32：`[0..3]`、`[4..7]`，含义见各原因文档。表达式示例：
`FsData.a_ResetContextData[0]*16777216 + FsData.a_ResetContextData[1]*65536 + FsData.a_ResetContextData[2]*256 + FsData.a_ResetContextData[3]`。

## 写入流程

1. **复位前** `FS_Reset_v_Cat2Reaction(reason, context)`：`e_SectionState = BUSY` → 写 `e_ResetReason`、
   `u_CoreNumber`、`u_ProcessId`、`u_SystemFlags`（调试器 / D-Cache）、8 字节上下文 → `VALID` →
   写 `u_MapVersion`、`u_SwVersion`、`u_Checksum` → 硬件复位。
   看门狗**自检**引起的 `FS_RESET_WATCHDOG` 不修改 SafeSection。
2. **启动时** `FS_Reset_v_StartUpTest`：
   - 硬件报告上电复位 → 只初始化，不写 NvM。
   - 等级为 0（非关键）或看门狗自检进行中 → 不写 NvM。
   - RAM 中原因仍是 `FS_RESET_UNEXPECTED_RESET`（复位前没来得及 Cat2Reaction）→ 从硬件寄存器读取原因
     （`Pal_Reset_e_GetResetReason`，上下文也由它填充），状态置 VALID。
   - 否则重算 CRC，不符则状态置 `INVALID`。
   - 原因不是 `INTENTIONAL_RESET` 时：`u_ResetCounter++`（封顶 `FS_RESET_MAX_NUMBER_OF_RESETS`，skill 参数 `MAX_RESETS`）；
     若本点火周期未进入 safe silent（`u_SystemFlags` bit14），执行 `FS_SafeSection_v_StoreToNvm(…, b_UseNextIndex = TRUE)`。
3. **StoreToNvm** → `FS_SafeSection_u_GetNextNvmIndex`：读索引块（1 字节，无 ROM 默认值）；读成功则 +1，
   **读失败（新 ECU / 块从未写过）则取 0** → 写回索引块 → `u_Index = 新索引` →
   写入 `Record[u_Index % SAFE_SECTION_NVM_BLOCKS]`（skill 参数 `NVM_BLOCKS`）→ CRC32 覆盖 `sizeof(Data) - 4` 字节。

   索引序列（3 块为例）：

   | 第 n 次存储 | 1 | 2 | 3 | 4 | … | 256 | 257 | 258 |
   |------------|---|---|---|---|---|-----|-----|-----|
   | 索引值 | 0 | 1 | 2 | 3 | … | 255 | 0 | 1 |
   | 写入块 | R0 | R1 | R2 | R0 | … | R0 | **R0** | R1 |

   索引是 uint8 计数，**不按块数循环**；"最新复位在哪个块" = `Record[索引 % NVM_BLOCKS]`。
   256 不能被 3 整除，所以 255→0 回绕时连续两次写 Record0，第 256 次的记录会被第 257 次覆盖（丢 1 条）。
   各项目的 `SAFE_SECTION_NVM_BLOCKS` / `FS_RESET_MAX_NUMBER_OF_RESETS` 不同（参考仓库中 3/10、3/9、3/4，部分 DPU 为 1 块），
   以本项目 `FS_SafeSection_Cfg.h` / `FS_Reset_Cfg.h` 为准。
4. ATIC 复位在启动时由 ATIC 模块直接写 NvM（`FS_RESET_FLAG_SAFESECTION_NVM_ATIC`），不经过 Cat2Reaction；
   demo dump 中这类记录 `e_SectionState = FREE`、`e_SharedInfoID = NONE`。TODO 结合 `FS_Atic.c` 确认。

## 推论（排查时常用）

- 索引块的值 = 最新一次复位的索引值；最新记录 = `u_Index` 等于它的那条（不要用 "u_Index 最大" 判断，回绕后会错）；
  保留的 NVM_BLOCKS 条记录的 `u_Index` 落在 `[最新-(NVM_BLOCKS-1), 最新]`（模 256）。
- 若未回绕，索引值 + 1 = 历史上存过的异常复位次数；回绕后无法从索引推断。
- "写了索引但记录没写完" 表现为索引指向的槽位仍是旧记录（序号不连续）。
- `u_ResetCounter` 是**连续**异常复位次数（封顶），不是总次数。TODO 确认清零条件。
