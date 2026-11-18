---
name: cross-block-consistency
kind: playbook
description: 用户问多个 block/字段之间是否一致、是否矛盾、逻辑关系、镜像/冗余是否相同、业务规则是否满足时使用。
keywords: [一致, 一致性, 矛盾, 冲突, 关系, 关联, 镜像, 冗余, 校验, 规则, consistency, mismatch, relation, mirror, redundant, rule, invariant]
tools: [nvm_checkRules, nvm_queryFields, nvm_evaluate, nvm_searchKnowledge]
priority: 5
---

## 步骤

1. 先跑已声明的知识：`nvm_checkRules()`（或只跑相关 skill）。block skill 中的
   `rules` / `relations` 是工程师写下的不变量和跨 block 关系，优先级最高。
2. 用户的问题没有被任何规则覆盖时，自己构造检查：
   - 对比同一字段在多个 block：`nvm_queryFields({ blocks: "A*,B*", fields: ["X", "$sequence"] })`
   - 校验两类 block 之间的关系：`nvm_evaluate({ expr: "self.X == other.Y", blocks: "A*", other: "B*" })`
   - 找出违反条件的 block：`nvm_queryFields({ blocks: "A*", fields: ["X"], where: "X > 100" })`
3. 表达式能力：字段路径（`a.b`、`arr[2].x`、`arr[]` 通配）、`$sequence`/`$versions`/`$isLatest`/
   `$attr.<key>`、比较、`&& || !`、位运算、`exists()/count()/sum()/any()/all()/distinct()`。
4. 若检查出不一致，再结合 `write-timeline` playbook 看是哪次写入引入的。

## 回答格式

- 结论：一致 / 不一致（数量）。
- 每个不一致项：block ↔ block、字段、两边的值、使用的规则或表达式。
- 若某条规则 "not evaluable"，说明缺什么（字段未解码 / block 不存在）。
- 当一个检查值得长期保留时，建议用户把它写进 block skill 的 `rules`/`relations`。
