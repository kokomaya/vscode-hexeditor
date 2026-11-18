# NVM Studio 软件架构 (Software Architecture)

> 一句话定位：在 VS Code 的 Hex Editor 自定义编辑器之上，构建的 **配置驱动、厂商无关、AI 可用** 的 AUTOSAR NVM Dump 分析平台。

## 架构总图

```mermaid
flowchart TB
    subgraph IN["① 输入层 · 工作区文件（零代码接入）"]
        direction LR
        DUMP["NVM Dump<br/>.mot / .s19 / .s37 / .hex"]
        DESC["布局描述符<br/>*.nvmlayout.json"]
        SRC["厂商辅助源<br/>Fee_Lcfg.c · *.arxml · *.h"]
    end

    subgraph HOST["② 扩展宿主 Extension Host · src/"]
        direction TB
        PROV["HexEditorProvider<br/>CustomEditorProvider 'hexEditor.hexedit'"]
        LOAD["tryLoadNvmBlocks<br/>扫描 dir · ./conf · ../conf<br/>按描述符声明读取 sources"]
        REG["HexEditorRegistry<br/>活动文档 · 解析结果缓存"]
        PROV --> LOAD --> REG
    end

    subgraph RESOLVE["③ 布局解析层 · src/nvm/layout/ （核心不认识任何厂商）"]
        direction TB
        CORE["resolveNvmBlocks ctx<br/>按能力编排 · 隔离异常 · 首个命中生效"]
        CAP["能力提供者 Capability Providers<br/>image: srecordImage · symbols: arxmlSymbols · defineSymbols"]
        T0["T0 位置式<br/>configLayout.ts<br/>静态偏移表"]
        T1["T1 结构化<br/>structuredLayout.ts<br/>声明式 profile"]
        T2["T2 引擎式<br/>externalEngine.ts + engineSdk.ts<br/>任意算法格式"]
        CORE --> CAP
        CORE --> T0
        CORE --> T1
        CORE --> T2
    end

    subgraph ENGINE["④ 外置引擎包 · engines/ （运行时加载，不入扩展包）"]
        direction LR
        PACK["vector-fee-v3<br/>engine.json + createEngine sdk"]
        GATE["安全闸门<br/>Workspace Trust<br/>hexeditor.nvm.allowExternalEngines<br/>单文件确认 · Web 端禁用"]
        GATE --> PACK
    end

    subgraph KERNEL["⑤ 厂商无关内核 · shared/nvm/ （Node + 浏览器双端安全）"]
        direction LR
        K1["memoryImage · model<br/>稀疏地址镜像 · 块模型"]
        K2["struct · cstruct · structRich<br/>结构体解码"]
        K3["crc · expr · link<br/>CRC 校验 · 安全表达式 · 地址跳转"]
        K4["arxml/ · defineEnum<br/>AUTOSAR 目录导入"]
    end

    PROTO{{"⑥ 契约层 · shared/protocol.ts<br/>MessageType.SetNvmBlocks / RevealNvmOffset<br/>NvmBlockInfo · NvmFieldInfo（编辑器相对 offset/length）"}}

    subgraph VIEW["⑦ 视图层 · media/ （Webview）"]
        direction LR
        ED["Hex 主编辑器<br/>React + Recoil<br/>selectedNvmUnitAtom 驱动着色"]
        DI["Data Inspector<br/>NvmByteExplain 逐字节释义"]
        BT["Blocks Table<br/>nvm-blocks"]
        CV["Custom Views<br/>nvm-custom"]
    end

    subgraph FEAT["⑧ 功能模块 · src/nvm/"]
        direction LR
        ANN["annotations<br/>书签 · 标签 · 备注<br/>sidecar / workspaceState"]
        REP["report<br/>Markdown 报告 + 预览"]
        DISC["discovery<br/>依赖文件递归发现"]
        EMG["engines<br/>引擎包安装与管理"]
        TREE["ui / blocks<br/>NVM Studio 活动栏树"]
    end

    subgraph AI["⑨ AI 层 · src/nvm/ai/ （单一门面，双表面复用）"]
        direction TB
        FACADE["NvmCapabilities<br/>厂商无关能力门面"]
        CHAT["Chat Participant @nvm<br/>id: hexEditor.nvm"]
        LMT["Language Model Tools × 9<br/>listBlocks · searchBlocks · getDecoded<br/>readBytes · analyzeBlock · riskDetection<br/>createNote · listAnnotations · exportReport"]
        FACADE --> CHAT
        FACADE --> LMT
    end

    CLI["⑩ 无界面通道 · tools/nvmcli.ts<br/>parse · crc · image · decode · decode-rich · import · feev3"]

    IN --> HOST
    LOAD --> RESOLVE
    T2 -.受控加载.-> ENGINE
    RESOLVE --> KERNEL
    ENGINE -.注入 SDK.-> KERNEL
    RESOLVE -->|"NvmBlockInfo 数组"| REG
    REG --> PROTO
    PROTO --> VIEW
    REG --> FEAT
    REG --> FACADE
    FEAT --> FACADE
    CLI --> KERNEL

    classDef input fill:#E8F1FB,stroke:#2E6FB7,color:#13293D
    classDef host fill:#E7F4EA,stroke:#2E8B57,color:#13293D
    classDef resolve fill:#FFF3DC,stroke:#C98A14,color:#13293D
    classDef engine fill:#FDE7E7,stroke:#C0392B,color:#13293D
    classDef kernel fill:#EFE7FB,stroke:#6B4BA1,color:#13293D
    classDef view fill:#E6F6F7,stroke:#1F7A8C,color:#13293D
    classDef ai fill:#FBE7F3,stroke:#A1356F,color:#13293D
    classDef neutral fill:#F2F3F5,stroke:#5A6270,color:#13293D

    class DUMP,DESC,SRC input
    class PROV,LOAD,REG host
    class CORE,CAP,T0,T1,T2 resolve
    class PACK,GATE engine
    class K1,K2,K3,K4 kernel
    class ED,DI,BT,CV view
    class FACADE,CHAT,LMT ai
    class ANN,REP,DISC,EMG,TREE,PROTO,CLI neutral
```

## 分层说明（演示讲解用）

| 层     | 职责                                                                     | 关键实现                                              |
|--------|--------------------------------------------------------------------------|-------------------------------------------------------|
| ① 输入 | 用户只需放入 dump + 一个 JSON 描述符；描述符自行声明需要哪些辅助源        | `*.nvmlayout.json`                                    |
| ② 宿主 | 拥有文档与编辑模型，负责描述符发现与源文件读取                            | `src/hexEditorProvider.ts`、`src/hexEditorRegistry.ts` |
| ③ 解析 | 核心只讲"能力"（image / symbols / layout / struct / annotations），不讲厂商 | `src/nvm/layout/resolveNvmBlocks`                     |
| ④ 引擎 | 算法型私有格式以独立包形式运行时加载，三重安全闸门                        | `engines/vector-fee-v3`                               |
| ⑤ 内核 | 零 VS Code 依赖，Node/浏览器/CLI 共用                                     | `shared/nvm/`                                         |
| ⑥ 契约 | 宿主与 Webview 的唯一通信面                                              | `shared/protocol.ts`                                  |
| ⑦ 视图 | 选择驱动着色：点哪个单元，才染哪个单元的字段                               | `media/editor/state.ts`                               |
| ⑧ 功能 | 标注、报告、依赖发现、引擎管理                                              | `src/nvm/*`                                           |
| ⑨ AI   | 一个门面同时支撑 `@nvm` 对话与 9 个模型工具                              | `src/nvm/ai/nvmCapabilities.ts`                       |
| ⑩ CLI  | 不启动编辑器即可验证解析链路                                             | `node dist/nvmcli.js`                                 |

## 三条设计主张（可作为结论页）

1. **厂商无关**：`shared/` 与 `src/nvm/layout/` 核心中不出现任何厂商或格式名；新厂商 = 一个描述符，或一个适配器，或一个引擎包。
2. **配置驱动**：没有匹配的描述符时，文件退化为纯 Hex 编辑器，零副作用、零强制。
3. **AI 原生**：解析结果通过统一能力门面暴露，对话与工具调用共享同一份语义，不做二次适配。
