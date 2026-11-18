---
name: count-and-statistics
kind: playbook
description: 用户问"有多少个 / 一共几个 / 统计 / 分布 / 占比 / how many / count"之类的计数或统计问题时使用。
keywords: [多少, 几个, 几次, 一共, 总共, 统计, 分布, 占比, count, how many, total, statistics, distribution]
tools: [nvm_describeDump, nvm_searchBlocks, nvm_searchKnowledge, nvm_queryFields]
priority: 10
---

## 先判断：数的是"block 个数"还是"业务量"

- **block 个数**（"有多少个 X 类 block"、"有几个 sector"）→ 数 block。
- **业务量**（"某事件一共发生了几次"、"某个计数器是多少"）→ 这个数通常存放在**某个 block 的某个字段**里，
  不是 block 的个数。

## 步骤

1. block 个数：调用 `nvm_describeDump` 拿精确聚合（name family、structure group、attribute 分布）。
   **不要**从上下文里截断的列表推算数量。
2. 业务量：
   1. 先看 Skill Catalog 中有没有描述这个量的 block skill；有就 `nvm_useSkill` 并按它指示读字段。
   2. 没有就调用 `nvm_searchKnowledge("<业务词>")`；仍没有再用 `nvm_searchBlocks("<业务词>")`
      （它会匹配 decoded 字段名）。
   3. 找到字段后用 `nvm_getDecoded` 读取值；同一字段分布在多个 block 时用
      `nvm_queryFields({ blocks, fields: [...] })` 一次列出。
3. 若任何结果 `hasMore = true`，继续翻页或明确说明结果是部分的。
4. 区分"当前值"（`latestOnly`）与"历史版本"——同一个逻辑 block 可能存了多个版本，不要重复计数。

## 回答格式

- 第一行给数字。
- 然后给依据：用了哪个工具、哪个 block / 字段、是否只算最新版本。
- 若信息确实不在 dump 中，说明查过哪些（skill / 搜索词），并建议需要补充的 block skill。
