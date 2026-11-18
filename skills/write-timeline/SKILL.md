---
name: write-timeline
kind: playbook
description: 用户问写入顺序、时序、先后、最近写了什么、某次写入前后发生了什么、写入频率/次数时使用。
keywords: [时序, 顺序, 先后, 之前, 之后, 最近, 最后一次, 写入, 历史, 版本, timeline, order, sequence, before, after, latest, history, write]
tools: [nvm_timeline, nvm_blockHistory, nvm_correlateWrites, nvm_describeDump]
priority: 5
---

## 前提

写入顺序来自 layout/engine 提供的通用 `sequence` 提示（越大越晚）。没有 sequence 的 block
无法排序——工具会报告 unsequenced 数量，回答时必须说明。

## 常见问题 → 工具

| 问题 | 调用 |
|------|------|
| 最近写了哪些 block | `nvm_timeline({ newestFirst: true, limit: 30 })` |
| X 写入前后还写了什么 | `nvm_timeline({ around: "X", window: 10 })` |
| X 一共写了几次 / 每次改了什么 | `nvm_blockHistory("X")` |
| A 和 B 是否总是一起写 / 谁先谁后 | `nvm_correlateWrites({ a: "A", b: "B", within: 3 })` |
| 某一类 block 的写入顺序 | `nvm_timeline({ match: ["Family*"] })` |

## 分析要点

1. 先确定锚点（出问题的 block / 最新的异常值），再向前看 window。
2. 用 `nvm_blockHistory` 找出值**第一次**变异常的版本，用它的 sequence 作为时间点，
   再 `nvm_timeline({ around })` 看同一时刻附近写入的其它 block（可能是原因或连带效应）。
3. "一起写入"不等于因果；用 `nvm_correlateWrites` 统计是否稳定伴随，再下结论。
4. 结论中引用 sequence 号和版本号作为证据。
