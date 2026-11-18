---
name: root-cause-investigation
kind: playbook
description: 用户要求排查问题根因、深度分析异常、"为什么会这样"、复杂故障需要综合时序/写入/逻辑/业务关系时使用。
keywords: [根因, 原因, 为什么, 排查, 异常, 故障, 问题, 深度分析, 诊断, root cause, why, investigate, anomaly, debug, diagnose]
tools: [nvm_listSkills, nvm_checkRules, nvm_timeline, nvm_blockHistory, nvm_correlateWrites, nvm_evaluate, nvm_createNote]
uses: [block-deep-dive, write-timeline, cross-block-consistency]
priority: 5
---

本 playbook 组合其它 skill 完成多步排查。先 `nvm_useSkill` 加载与问题相关的组合 skill
以及 Skill Catalog 中相关的 block skill（项目知识）。

## 排查流程

1. **界定现象**：哪个 block / 字段 / 值异常？用 `block-deep-dive` 的步骤确认当前值和含义。
2. **已知约束**：`nvm_checkRules()` —— 项目 block skill 声明的规则和关系里，哪些失败了？
   失败项通常直接指向问题点。
3. **时间线**：对异常 block `nvm_blockHistory`，找到值第一次变异常的版本（sequence = T）。
4. **同期写入**：`nvm_timeline({ around: <block>, window: 15 })` 看 T 附近还写了什么；
   对可疑的 block 用 `nvm_correlateWrites` 判断是否稳定伴随（写入关系）。
5. **逻辑关系**：用 `nvm_evaluate` / `nvm_queryFields` 验证假设（例如"计数器应等于镜像"、
   "状态位置位时必须有冻结帧"）。每个假设给出 ✓/✗ 与证据。
6. **业务解释**：只用 skill 中写明的业务含义解释结论；skill 没写的部分标注为推测。
7. **记录**（可选，需用户确认）：把确认的发现用 `nvm_createNote` 锚定到对应 block。

## 回答格式

- **结论**（最可能的根因 + 置信度）
- **证据链**：现象 → 规则失败 → 首次异常版本(seq) → 同期写入 → 验证的表达式
- **未确认 / 需要补充的信息**（缺少的 block skill、未解码的 block、无 sequence）
- **建议**：下一步检查或应补充到 block skill 中的规则
