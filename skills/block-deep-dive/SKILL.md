---
name: block-deep-dive
kind: playbook
description: 用户要求分析/解释某一个 block（是什么、字段含义、值是否正常、为什么是这个值）时使用。
keywords: [分析, 解释, 是什么, 含义, 字段, 正常吗, analyze, explain, meaning, field, decode]
tools: [nvm_searchBlocks, nvm_analyzeBlock, nvm_getDecoded, nvm_blockHistory, nvm_checkRules, nvm_readBytes]
priority: 5
---

## 步骤

1. 定位：名字不确定时先 `nvm_searchBlocks`；拿到准确名字。
2. 结构：`nvm_getDecoded(name)` 读解码值。结果末尾若有 `knowledge:` 段，说明有 block skill
   描述它——调用 `nvm_useSkill` 读完整说明再解释。
3. 没有 decoded：`nvm_analyzeBlock` 看几何/字段，必要时 `nvm_readBytes` 看原始字节；
   不要编造字段含义，说明"需要 struct 定义（block skill 的 `struct`）"。
4. 历史：若该 block 有多个版本，`nvm_blockHistory(name)` 看每次写入改了什么。
5. 校验：若 block skill 声明了 rules/relations，`nvm_checkRules({ skills: [<skill>] })`。

## 回答格式

- 一句话说明它是什么（来自 skill；没有 skill 时明确说是推测）。
- 关键字段表：字段 / 值 / 含义 / 是否异常。
- 异常点与证据（版本、sequence、规则名）。
