// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Templates written by "NVM: New Skill…". They are intentionally skeletons with
 * TODO markers: the engineering knowledge belongs to the project engineer.
 */

export function playbookTemplate(name: string): string {
	return `---
name: ${name}
kind: playbook
description: >
  TODO 一句话写清"什么时候用"：用户问 …… 时使用。(≤ 300 字符)
keywords: [TODO, 关键词, keyword]
# tools: [nvm_describeDump, nvm_searchBlocks, nvm_timeline]   # 建议使用的工具（提示）
# uses: [some-block-skill, another-playbook]                  # 组合其它 skill
priority: 0
---

## 适用场景
TODO

## 步骤
1. TODO 先调用 \`nvm_…\` 获取 ……
2. TODO 再 ……
3. 若结果 \`hasMore = true\`，翻页或说明结果是部分的。

## 回答格式
- 先给结论，再给依据（工具、block、字段、sequence）。
`;
}

export function blockTemplate(name: string): string {
	return `---
name: ${name}
kind: block
description: >
  TODO 这个 block 是什么；用户问 …… 时使用。(≤ 300 字符)
keywords: [TODO]
appliesTo:
  blocks: ["TODO_BlockName*"]        # block 名 glob（大小写不敏感）
  # ids: ["0x0000"]                  # block id / identity key
  # attributes: { section: "TODO*" } # block attribute（key → glob）
  # layout: "*"                      # 只在某个 layout provider / vendor 下生效
# 结构体 layout 以 *.nvmlayout.json 配置为准。只有配置未解码的 block 才需要下面的兜底 struct：
# struct: ${name}.struct.json          # 可选：兜底 NvmStructDef catalog（见同目录模板）
# decodeMode: fill                   # 默认 fill（配置为准，关闭覆盖）；override = 显式用本 struct 替换配置的解码
# params: { TODO_BLOCKS: 3 }         # 规则 / 关系中可直接引用的常量（项目配置值），建议大写
# structRoot: TODO_Struct_t
# payloadOffset: 0                   # payload 在 block 内的起始偏移
fields:
  # TODO_Field:   { meaning: "TODO 含义", unit: "count" }
  # TODO_Array[]: { meaning: "TODO 数组每个元素的含义" }
valueDocs:                           # 按“值”路由到说明文档（资源路径或 skill:<name>），先具体后宽泛
  # TODO_Reason:
  #   "TODO_VALUE_A*": docs/value-a.md
  #   "*": docs/other.md
rules:
  # - id: TODO-invariant
  #   expr: "TODO_Field >= 0"        # 单 block 不变量（字段路径、$sequence、$versions…）
  #   severity: warning
  #   message: "TODO 违反时的解释"
relations:
  # - id: TODO-order
  #   kind: order                    # order | value | presence | cowrite | reference
  #   with: "TODO_Other*"
  #   expect: before                 # before | after | together | present | absent
  #   within: 5
  #   meaning: "TODO 业务含义：为什么应该先写 A 再写 B"
  # - id: TODO-consistent
  #   kind: value
  #   with: "TODO_Mirror*"
  #   expr: "self.TODO_Field == other.TODO_Field"
---

## 这是什么
TODO 由哪个模块、在什么时机写入；与哪些 block 相关。

## 如何回答常见问题
- "TODO 问题" → 读取 \`TODO_Field\`，……

## 注意
- TODO 回绕、无效值、默认值等。
`;
}

export function structTemplate(): string {
	return `${JSON.stringify(
		{
			structs: {
				TODO_Struct_t: {
					name: "TODO_Struct_t",
					endian: "little",
					fields: [
						{ name: "TODO_Field", type: "u16" },
						{ name: "TODO_Reason", type: "u8", compu: { enum: "TODO_Enum" } },
						{ name: "TODO_Array", type: "u8", dims: [8] },
					],
				},
			},
			enums: {
				TODO_Enum: { name: "TODO_Enum", values: { "0": "TODO_NONE", "1": "TODO_VALUE" } },
			},
		},
		null,
		2,
	)}\n`;
}
