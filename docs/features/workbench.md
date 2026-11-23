# NVM 工作台（Workbench）

打开 dump 后，编辑器标签页就是一个可自由组合的工作台：表格、Hex、Inspector 等视图都是可拖拽、可分组、可关闭的面板。
设置 `nvmstudio.nvm.layoutMode = "classic"` 可回到只有 Hex 的经典界面（重新打开 dump 生效）。

## 视图

| 视图 id | 名称 | 多实例 | 参数 (`params`) |
| --- | --- | --- | --- |
| `nvm.blocksTable` | Blocks 表格 | ✅ | `search`、`sort: { key, dir: 1 \| -1 }`、`columns: string[]`、`latestOnly` |
| `nvm.hex` | Hex | ❌ | — |
| `nvm.inspector` | Inspector | ❌ | — |
| `nvm.overview` | 概览 | ❌ | — |
| `nvm.blocksTree` | 树 | ✅ | `arrangement: "flat" \| "sector" \| "write" \| "identity"` |
| `nvm.customView` | 自定义视图 | ✅ | `customViewId` |
| `nvm.annotations` | 标注清单 | ❌ | — |

工具栏右侧的**统一搜索框**同时匹配：地址（`0x1A2B` / `1A2Bh`）、block 名 / id、属性值、解码字段名和值（含枚举名）、书签 / 笔记 / 标签；方向键选择、回车定位。

**概览**页的 *Findings* 来自 host：通用风险检测 + 已加载 skill 的规则 / 关系检查失败项（可点击定位）；*Ask @nvm* 中带边框的问题来自与当前 dump 绑定的 skill 和 playbook。

表格的列 key：`__name`、`__offset`、`__length`，以及 block 的通用属性 key（如结构化描述符产生的 `blockId`、`status`、`crc`、`version`）。
**在表头上右键**弹出列菜单：点一列隐藏、再点显示（菜单保持打开，可连续切换），"Show all columns" 恢复全部。

## 标注（Annotations）

- Hex 右键、Hex 悬停卡片、**表格 / 树的行右键**都能 *Add Bookmark / Add Note / Tag / Remove Tag*；从行上触发时目标是整个 block。
- 添加 note：输入标题后**回车即创建并直接打开 note 的 Markdown 文件**，占位行已选中，可直接输入。
- 任何来源（命令、侧栏、AI）改了标注，打开的编辑器都会自动刷新。

## 报告

**NVM: Export Report** / 概览页 "Open report preview" 生成的报告按概览页的结构组织：
Overview 指标 → Findings（风险 + skill 规则，标出所属 block）→ Most recent write → Most rewritten → Blocks per group →
**Annotations**（notes 含正文、bookmarks、tags，每条标出所属 block）→ 附录：完整 block 列表。

## 布局文件格式

内置预设、场景布局、用户另存的布局、AI 生成的布局都使用同一种格式：

```jsonc
{
  "version": 1,
  "id": "reset-investigation",
  "name": "Reset investigation",
  "requires": ["layout"],                                   // 需要已识别的 NVM 布局
  "when": { "anyBlockMatches": "Nvm_SafeSection_*" },       // 可选：自动推荐条件（block 名 glob）
  "root": {
    "split": "horizontal",                                  // horizontal = 左右并排；vertical = 上下堆叠
    "sizes": [55, 45],                                      // 相对大小
    "children": [
      { "tabs": [{ "view": "nvm.blocksTable", "params": { "search": "SafeSection" } }] },
      { "tabs": [{ "view": "nvm.hex" }, { "view": "nvm.inspector" }], "active": 0 }
    ]
  }
}
```

规则：未知视图会被忽略；单例视图只保留第一次出现；同方向的嵌套 split 会被合并；无法显示任何视图时回退到内置布局。

## 布局来源

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 内置 | 插件 | 表格主导（有 layout 时默认）、Hex 主导、结构浏览、调查标注、概览 |
| 场景 | dump 同目录 / `./conf` / `../conf` 下的 `*.nvmworkbench.json`；skill 目录下的 `layouts/*.json` | 首次打开 dump 时，第一个 `when` 匹配的场景布局自动选用 |
| 用户 | 工具栏“另存为”（工作区或个人） | 出现在“My layouts”分组 |

- 对任何预设的修改都保存为**覆盖层**，工具栏显示 `● modified`，**Reset** 恢复原样。
- 每个 dump 记住上次使用的预设。
- **NVM: Workbench: Export Layout as Scenario File…** 把当前布局导出为 `*.nvmworkbench.json`，放在 dump 旁边即可与同事共享。

## AI 驱动

`@nvm` 和 Copilot 可通过以下工具操作工作台（都是只读的视图操作）：

| 工具 | 作用 |
| --- | --- |
| `nvm_reveal` | 定位 block / 地址，同步 Hex、表格、Inspector |
| `nvm_filterTable` | 设置表格搜索、排序、列、只看最新 |
| `nvm_showView` | 打开 / 聚焦视图 |
| `nvm_applyLayout` | 切换预设（内置 / 场景 / 用户）或应用临时布局 |
| `nvm_loadStatus` | 说明 dump 为何（未）被识别 |

Chat 命令：`/help`、`/explain`（当前选中）、`/why`（识别状态）、`/note`、`/skills`、`/noskills`。回答末尾会为提到的 block 生成 **Show …** 按钮。

**把 AI 结论存成 note**：每个回答下有 *Save conclusion as note…* 按钮（在输入框预填 `@nvm /note `，可补充总结要求后回车）和 *Save as note* 跟进项（直接按默认方式总结）。
`/note [要求]` 把上一条回答压缩成"标题 + 2–5 条要点"，挂到：要求里点名的 block → 回答里第一个提到的 block → 当前选中位置；完成后给出 *Open note* 按钮。

## 新手入口

- **Dump & Config** 视图：当前 dump 的识别状态、描述符、依赖文件、engine、编辑器模式，每项可点击修复。
- **NVM: Get Started**：6 步上手引导。
- **NVM: Open Sample Dump**：内置的合成示例（`samples/basic-log/`，由 `tools/makeSampleDump.ts` 生成），含 4 个逻辑 block 的多次写入和 1 个 CRC 错误，以及一个场景布局示例。

## 从服务器安装

安装服务器（`server/`，可直接运行的示例在 `server/demo/`）同时提供 engine（按 供应商/layout版本 分目录）、layout 配置和 **skills**：

- **NVM: Install from Server (Project Engines + Configs + Skills)…**：输入服务器 IP（`10.1.2.3` 即可，默认端口 7788）→ 选择 产品/平台/项目 →
  安装该项目 `level.json` 绑定的 engine 和描述文件、这些描述文件引用的 engine、该项目可见的 skills，并把它设为 skill 上下文。也可选 "Everything on the server"。
- **NVM: Install Skills from Server…**（Skills 视图标题栏也有按钮）：列出服务器上的 skill，勾选后在后台（可取消的进度通知）下载到 `<NVMSTUDIO_HOME>/skills/`（保持服务器上的 产品/平台/项目 文件夹），完成后自动重新加载 skills。
- **NVM: Select Skill Context…**（Skills 视图顶部的 *Context* 行）：选择当前的 产品/平台/项目，决定哪些层级的 skill 生效；描述符里的 `skillContext` 优先。规则见 `docs/features/skills.md` §5.1a。
- 描述文件写 `"engine": "vector/fee-v3"`（服务器上的文件夹路径）；旧的 `"engine": "vector-fee-v3"`（`engine.json` 的 id）仍可解析。
- 服务器地址会被记住，下次直接回车。服务器端结构和接口见 `server/README.zh-CN.md`。
