---
name: reset-record
kind: block
description: >
  ECU 异常复位记录（FS SafeSection）。用户问 reset 次数、复位原因、最近几次复位、复位上下文/寄存器、
  复位与 DTC 的关系时使用。
keywords: [reset, 复位, 重启, 异常复位, 复位记录, reset record, 复位原因, reset reason, safe section, SafeSection, watchdog, 看门狗, exception, 异常, cat2]
appliesTo:
  blocks: ["Nvm_SafeSection_Data_Record*"]
# 结构体 layout 由 conf/vector_structs.demo.nvmlayout.json（FS_SafeSection_t_Data）提供，配置为准，
# 这里不指定 struct。只有配置未解码这些 block 时才需要兜底 struct；
# decodeMode 默认 fill（关闭覆盖），确需用 skill 的 struct 替换配置解码时才设为 override。
# decodeMode: fill
params:
  # 项目配置值，规则/关系中直接引用。TODO 按本项目 FS_SafeSection_Cfg.h / FS_Reset_Cfg.h 确认：
  # adas_embed_mon 中 ars640_iuc = 3 / 10，ars540_iuc = 3 / 9，rad6_iuc = 3 / 4，部分 *_dpu 只有 1 个 block。
  NVM_BLOCKS: 3        # SAFE_SECTION_NVM_BLOCKS：Record 块个数
  MAX_RESETS: 10       # FS_RESET_MAX_NUMBER_OF_RESETS：u_ResetCounter 上限
  MAP_VERSION: 15      # 已用 CRC 核对过的布局版本（FS_SAFE_SECTION_MAP_VERSION）
fields:
  u_MapVersion:              { meaning: "SafeSection 布局版本（FS_SAFE_SECTION_MAP_VERSION）；与解码用的头文件版本不一致时需复核 layout" }
  e_SectionState:            { meaning: "记录状态：VALID=写入完整；BUSY=写入途中复位；INVALID=启动时 CRC 校验失败；FREE=未经 Cat2Reaction 写入（见 reasons/encoding-and-classes.md）" }
  u_Index:                   { meaning: "写入时的索引值：首次为 0，每存一次 +1，uint8 到 255 后回到 0（不按块数循环）；存放块 = Record[u_Index % NVM_BLOCKS]；与索引块值相等的那条是最新复位" }
  FsData.e_SharedInfoID:     { meaning: "FsData.Shared 联合体中有效成员（MAP 15：1 MCU/2 TASK/3 OS/4 VOLTAGE/5 OSEXT/6 FCCU/7 STACK/8 PMIC，0 NONE=无）" }
  FsData.u_ResetCounter:     { meaning: "连续异常复位计数：每次存储异常复位 +1，封顶 FS_RESET_MAX_NUMBER_OF_RESETS；不是全生命周期总复位次数", unit: "count" }
  FsData.e_ResetReason:      { meaning: "复位原因：bit0..13 = 原因号，bit14..15 = 等级（0 非关键/1 软件/2 IUC 内部/3 IUC 外部）" }
  FsData.a_ResetContextData[]: { meaning: "原因相关的 8 字节上下文（多为两个大端 u32），含义随复位原因而定（见对应 reasons/*.md）" }
  FsData.u_CycleCounter:     { meaning: "复位发生时的运行时间（自上电起）", unit: "ms" }
  FsData.u_SystemFlags:      { meaning: "系统标志：bit15 调试器连接，bit14 本点火周期进入过 safe silent，bit0 D-Cache，bit1 I-Cache" }
  FsData.u_CoreNumber:       { meaning: "触发复位的核号（+ FS_RESET_CORE_NUMBER_OFFSET）" }
  FsData.u_WdogTestStep:     { meaning: "看门狗自检步骤（跨复位保留）" }
  FsData.u_WdogErrFlags:     { meaning: "看门狗错误标志（跨复位保留）" }
  FsData.u_SwVersion:        { meaning: "复位时运行的软件版本" }
  FsData.u_ProcessId:        { meaning: "复位时注册的进程 ID（FS_Reset_v_RegisterProcessId）" }
  FsData.Shared.Mcu.u_ExceptionID:  { meaning: "CPU 异常类型号（平台相关，见 reasons/exception.md）" }
  FsData.Shared.Mcu.u_ExceptFlags:  { meaning: "异常状态/故障状态寄存器" }
  FsData.Shared.Mcu.u_MachineState: { meaning: "异常时的程序状态寄存器（PSR）" }
  FsData.Shared.Mcu.u_InstrAddress: { meaning: "异常时 PC（出错指令地址）——用 map 文件定位函数" }
  FsData.Shared.Mcu.u_DataAddress:  { meaning: "数据异常的故障地址" }
  FsData.Shared.Mcu.u_StackPointer: { meaning: "异常时栈指针" }
  FsData.Shared.Mcu.a_CallStack[]:  { meaning: "回溯得到的返回地址（调用栈）" }
  u_Checksum:                { meaning: "CRC32，覆盖 u_Checksum 之前的全部字节（FS_SafeSection_u_CalcCrc）" }
valueDocs:
  # 一个复位原因 → 一份说明；先具体后宽泛，第一个匹配生效。新增原因只需加一行 + 一个文档。
  FsData.e_ResetReason:
    "FS_RESET_NONE": reasons/poweron-intentional.md
    "FS_RESET_POWER_ON": reasons/poweron-intentional.md
    "FS_RESET_INTENTIONAL_RESET": reasons/poweron-intentional.md
    "FS_RESET_UNEXPECTED_RESET": reasons/unexpected-external.md
    "FS_RESET_EXTERNAL_RESET": reasons/unexpected-external.md
    "FS_RESET_DESTRUCTIVE_RESET": reasons/unexpected-external.md
    "FS_RESET_EXCEPT*": reasons/exception.md
    "FS_RESET_WATCHDOG*": reasons/watchdog.md
    "FS_RESET_STARTUP_TIME_EXCEEDED": reasons/watchdog.md
    "FS_RESET_TASK_*": reasons/task-monitor.md
    "FS_RESET_CHECKPOINT_*": reasons/task-monitor.md
    "FS_RESET_MONITOR_INTERVAL_TIME": reasons/task-monitor.md
    "FS_RESET_STACK_*": reasons/stack.md
    "FS_RESET_ECC_*": reasons/memory.md
    "FS_RESET_RAM_PARITY_ERROR": reasons/memory.md
    "FS_RESET_ADDRESS_*": reasons/memory.md
    "FS_RESET_MEMTEST": reasons/memory.md
    "FS_RESET_ATIC_*": reasons/atic-pmic.md
    "FS_RESET_CLKMON_*": reasons/clock.md
    "FS_RESET_UBATT_*": reasons/voltage-temperature.md
    "FS_RESET_TEMP_*": reasons/voltage-temperature.md
    "FS_RESET_MCU_*": reasons/voltage-temperature.md
    "FS_RESET_VOLTAGE_*": reasons/voltage-temperature.md
    "FS_RESET_NTC_*": reasons/voltage-temperature.md
    "FS_RESET_MMIC_*": reasons/voltage-temperature.md
    "FS_RESET_SOC_*": reasons/voltage-temperature.md
    "FS_RESET_STARTUP_CONDITION": reasons/voltage-temperature.md
    "FS_RESET_FCCU_*": reasons/fccu.md
    "FS_RESET_FPGA_*": reasons/fpga.md
    "FS_RESET_DSP_*": reasons/dsp-dpu.md
    "FS_RESET_DPU_*": reasons/dsp-dpu.md
    "FS_RESET_OS_*": reasons/os-ecum.md
    "FS_RESET_ECUM_REQUEST": reasons/os-ecum.md
    "FS_RESET_GUARD_VIOLATION": reasons/os-ecum.md
    "FS_RESET_APPL_*": reasons/sw-integrity.md
    "FS_RESET_XPAR_*": reasons/sw-integrity.md
    "FS_RESET_HW_SW_INCOMPATIBLE": reasons/sw-integrity.md
    "FS_RESET_RFCOM_INCOMPATIBLE": reasons/sw-integrity.md
    "*": reasons/hw-selftest-other.md
  FsData.e_SharedInfoID:
    "*": reasons/shared-info.md
rules:
  - id: record-valid
    # ATIC 复位在启动时由 ATIC 模块直接写入，状态为 FREE 属正常（TODO 结合 FS_Atic.c 确认）
    expr: "label(e_SectionState) == 'FS_SECTION_STATE_VALID' || (label(e_SectionState) == 'FS_SECTION_STATE_FREE' && glob(label(FsData.e_ResetReason), 'FS_RESET_ATIC_*'))"
    severity: warning
    message: "记录不是 VALID：BUSY=写入途中又复位（内容可能不完整），INVALID=启动时 CRC 校验失败，FREE=未经 Cat2Reaction 写入（见 encoding-and-classes.md）"
  - id: stored-in-right-slot
    expr: "u_Index % NVM_BLOCKS == trailingNumber($name)"
    severity: error
    message: "记录的 u_Index 与所在块不符（应存于 Record[u_Index % NVM_BLOCKS]）——NVM_BLOCKS 参数与项目不符，或块映射异常"
  - id: counter-capped
    expr: "FsData.u_ResetCounter <= MAX_RESETS"
    severity: warning
    message: "u_ResetCounter 超过 FS_RESET_MAX_NUMBER_OF_RESETS（参数 MAX_RESETS）——参数与项目不符，或 RAM 数据损坏"
  - id: not-a-silent-reason
    expr: "label(FsData.e_ResetReason) != 'FS_RESET_INTENTIONAL_RESET' && label(FsData.e_ResetReason) != 'FS_RESET_POWER_ON'"
    severity: warning
    message: "上电复位和主动复位按设计不会写入 NvM；出现说明写入路径或 layout 有问题"
  - id: exception-has-mcu-dump
    expr: "label(FsData.e_ResetReason) != 'FS_RESET_EXCEPTION' || label(FsData.e_SharedInfoID) == 'FS_SHARED_INFO_MCU'"
    severity: info
    message: "处理器异常复位通常带 MCU 寄存器快照（Shared.Mcu）；缺失说明异常发生在寄存器保存之前"
  - id: layout-revision
    expr: "u_MapVersion == MAP_VERSION"
    severity: info
    message: "u_MapVersion 与已核对的布局版本（参数 MAP_VERSION）不同——请换用对应 FS 版本的 FS_SafeSection_Types.h / Prv.h（例如 MAP 16 的 Shared 成员编号不同）"
relations:
  - id: index-points-to-retained-records
    kind: value
    with: "Nvm_SafeSection_Index"
    expr: "(other.u_NvmIndex - self.u_Index + 256) % 256 < NVM_BLOCKS"
    severity: error
    meaning: "索引块保存最新一次复位的索引值；各 Record 的 u_Index 应落在 [最新-(NVM_BLOCKS-1), 最新]（模 256）。不满足说明索引块与记录不同步（写索引后、写记录前掉电等），或发生了 255→0 回绕覆盖（见 encoding-and-classes.md）"
  # TODO 复位上报 DEM：FS_Reset_v_ReportErrorResetToDem 为非主动/非上电复位上报
  #   FS_MON_CAT1_ERROR_RESET / FS_MON_CAT2_IUC_INTERNAL / FS_MON_CAT2_IUC_EXTERNAL / FS_MON_CAT2_SW_RELATED（被动事件）。
  #   确认这些事件在本项目 DEM 中对应的 block / EventId 后启用：
  # - id: reset-reported-to-dem
  #   kind: presence
  #   with: "DemPrimaryDataBlock*"
  #   expect: present
  #   meaning: "异常复位应在 DEM 中留下 CAT1/CAT2 事件（pre-extended data = 复位原因 + 上下文 8 字节）"
---

## 这是什么

FS（Functional Safety）模块在发生 Cat2 复位前把复位现场写入 RAM 中的 SafeSection
（`FS_SafeSection_t_Data`），下次启动时 `FS_Reset_v_StartUpTest` 把它保存到 NvM：

- `Nvm_SafeSection_Data_Record0..(NVM_BLOCKS-1)`：最近 NVM_BLOCKS 次异常复位，按 `u_Index % NVM_BLOCKS` 轮换存放。
- `Nvm_SafeSection_Index`：只存一个 `u8`（NvM 长度 1 字节，无 ROM 默认值），即**最新一次复位的索引值**。

索引规则（`FS_SafeSection_u_GetNextNvmIndex`）：每次存储前读索引块并 +1 写回；**读失败（新 ECU / 块从未写过）
时取 0**——所以第一次复位的索引是 0，存入 Record0；之后 1→Record1、2→Record2、3→Record0……
索引本身按 uint8 计数，到 255 后回到 0，**不按块数循环**；"当前最新复位在哪个块" = `Record[索引 % NVM_BLOCKS]`。
例：NVM_22.11_9 的索引块 = 7 → 最新复位在 Record1（7 % 3 = 1），其余两条依次是 6（Record0）、5（Record2）。

存储流程、复位等级与 DEM 上报细节见 `reasons/encoding-and-classes.md`。

## 如何回答常见问题

- **"最近一次为什么复位"** → 读 `Nvm_SafeSection_Index.u_NvmIndex`，最新记录是 `Record[u_NvmIndex % NVM_BLOCKS]`
  （即 `u_Index == u_NvmIndex` 的那条；不要用"u_Index 最大"判断，回绕后会出错），
  读 `FsData.e_ResetReason`，然后按 knowledge 段提示读取对应的 `reasons/*.md`。
- **"最近几次复位的原因"** → `nvm_queryFields({ blocks: "Nvm_SafeSection_Data_Record*", fields: ["u_Index", "FsData.e_ResetReason", "FsData.u_CycleCounter", "e_SectionState"] })`，
  按 `(索引块值 - u_Index + 256) % 256` 从小到大排序（0 = 最新）。
- **"一共复位了多少次"** → NvM 里会尽可能多的保存异常，复位信息，直至NVM翻页擦除；`FsData.u_ResetCounter` 是**连续**异常复位计数，不是总次数。全生命周期次数不在 SafeSection 中——如实说明，并建议查 DEM 事件计数（TODO 指明项目中对应的 block）。
- **"复位时在干什么"** → `e_SharedInfoID` 指出 `Shared` 中哪个成员有效（见 `reasons/shared-info.md`）；
  处理器异常读 `Shared.Mcu`，地址类字段用 map 文件定位（`nvm_useSkill("reset-exception-analysis")`）。
- **"这条记录可信吗"** → `nvm_checkRules({ skills: ["reset-record"] })`：状态、槽位、计数上限、与索引块的一致性。

## 注意

- **版本相关**：本 demo 的头文件已切换到 `FS_SAFE_SECTION_MAP_VERSION 15`（adas_embed_mon @ 8d64cb6b，与 dump 中
  `u_MapVersion = 15` 一致）。MAP 15 与 16 的差异：`Shared` 成员编号（15：7 STACK / 8 PMIC；16：7 STACK_1 / 8 STACK_2 / 9 PMIC）、
  复位原因编号（如 78/79、134/135 互换，若干原因增删）。`u_Checksum` 能用 CRC32 复核即说明 layout 正确（已核对）。
- `u_Index` 0..255 回绕，比较新旧按模 256 计算；NVM_BLOCKS 不整除 256 时，255→0 回绕那一次会**覆盖刚写入的记录**
  （例如 3 块：255 和 0 都落在 Record0），见 `reasons/encoding-and-classes.md`。
- **FEE 中的历史副本**：同一个 Record 块被重写后，旧副本在 FEE 扇区回收前仍留在 dump 中，可借此找回超过 NVM_BLOCKS 条的复位。
  需在 layout 配置的 engine options 中打开 `decodeStale: true`，再用 `nvm_blockHistory("Nvm_SafeSection_Data_Record0")`
  （逐个 Record）或 `nvm_queryFields({ ..., latestOnly: false })` 列出全部副本，按 `u_Index` 去重排序。
  （两份 demo dump 中目前没有残留的 SafeSection 旧副本。）
- 上电复位、主动复位（`FS_RESET_INTENTIONAL_RESET`）、看门狗自检引起的复位、safe silent 期间的复位**不会**写入 NvM。
