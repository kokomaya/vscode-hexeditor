# Skill 模板

这些目录是**模板 / 示例**，不会被自动加载。复制到任意 skill 根目录后使用并补全 `TODO`：

- `~/nvmstudio/skills/`（用户级，默认）
- `<workspace>/.nvmstudio/skills/`（工作区，可提交）
- 与 `*.nvmlayout.json` 同处的 `conf/skills/`（项目知识跟着配置走）
- `nvmstudio.nvm.skillRoots` 中配置的目录

| 模板 | kind | 演示 |
|------|------|------|
| `ecu-reset-counter/` | block | **真实示例**（ARS620CN15 demo）：不写 struct（以配置为准）、`fields` 释义、`valueDocs` 按复位原因路由到 `reasons/*.md`、`rules`、与索引块的 `value` 关系。已在 demo dump 上验证通过 |
| `reset-exception-analysis/` | playbook | 某一类原因需要独立的多步流程时，单独做成 playbook（异常 → map 文件定位） |
| `dem-event-memory/` | block | 多版本 block、`cowrite` / `presence` / `reference` 关系 |
| `reset-dtc-investigation/` | playbook | `uses` 组合多个 skill 做跨 block 时序 + 逻辑排查 |

## 一个 block 有很多种"值"（例如 150+ 种复位原因）时怎么组织？

推荐 **一个 block skill + 按值路由的文档**，而不是每种原因一个 skill：

```text
ecu-reset-counter/
├─ SKILL.md            # 绑定、字段释义、规则、关系、valueDocs 路由表
└─ reasons/
   ├─ encoding-and-classes.md   # 公共：编码、等级、存储流程、DEM 上报
   ├─ exception.md              # 一类原因一份文档
   ├─ watchdog.md
   └─ …
```

```yaml
valueDocs:
  FsData.e_ResetReason:            # 字段路径
    "FS_RESET_EXCEPT*": reasons/exception.md          # glob 匹配枚举名（或数值），先具体后宽泛
    "FS_RESET_WATCHDOG*": reasons/watchdog.md
    "FS_RESET_FOO": "skill:foo-analysis"               # 也可以指向另一个 skill
    "*": reasons/hw-selftest-other.md                   # 兜底
```

AI 读取某条记录时，工具结果会直接提示"当前值由哪份文档解释"，只加载需要的那一份（省 token）。
只有当某类原因需要**独立的排查流程**（需要别的工具 / 外部文件，例如 map 文件）时，才单独做成 playbook skill。

原因：block skill 负责"绑定 + 结构"，一种原因一个 skill 会重复绑定同一批 block、让 Skill Catalog 膨胀，
而且原因与 block 不是一对一关系；按值路由则新增原因只需加一行路由 + 一个文档。

注意：glob 若是纯数字（如 `"16394"`），YAML map 中会被排到最前面——数值路由请放在最具体的位置或改用枚举名。

## 结构体 layout 以配置为准

`*.nvmlayout.json`（engine / C 头文件）解码过的 block，skill 的 `struct` **不会**再解码或覆盖它；skill 的 struct
只用于配置没覆盖的 block（兜底），且不会传给 engine。`decodeMode` 默认 `fill`（覆盖关闭）；确实需要用 skill 的 struct
修正配置的解码时，在该 skill 中显式写 `decodeMode: override` 打开，日志中会对每个 dump 给出 "override" 警告。

## 项目配置值用 params

不同项目的配置值不同（如 `SAFE_SECTION_NVM_BLOCKS`、`FS_RESET_MAX_NUMBER_OF_RESETS`），写进 `params`，规则里直接引用：

```yaml
params: { NVM_BLOCKS: 3, MAX_RESETS: 10 }
rules:
  - id: slot
    expr: "u_Index % NVM_BLOCKS == trailingNumber($name)"
```

也可以用命令 **NVM: New Skill…** 生成空模板。写完后用 **NVM: Show Skill Diagnostics** / **NVM: Check Skill Rules & Relations** 检查。
