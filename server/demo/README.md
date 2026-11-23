# Demo 服务器数据根

可以直接运行的示例，照着它的结构放自己的内容即可。

```
start.cmd / start.sh              以本目录为数据根启动服务器(端口 7788)
sync-engines.mjs                  把仓库构建出的引擎(dist/engines)同步进来(见下)
engines/
  demo-vendor/log-v1/             自包含的示例引擎：解析 samples/basic-log/sample-nvm.mot
  vector/fee-v3/                  由 sync-engines.mjs 生成(不提交)
conf/
  radar/chipA/customerB/          customerB 项目的描述文件：引擎 demo-vendor/log-v1 + block 名称
  vector/fee-v3/                  由 sync-engines.mjs 生成：Vector 引擎自带的标准描述文件
skills/radar/                     产品 雷达
  level.json                      绑定 engine vector/fee-v3 + conf vector_structs.demo(解码 SafeSection / DEM)
  reset-record/ …                 应用层 skills，来自 docs/features/skill-templates(保持一致，有测试检查)
  reset-exception-analysis/  dem-event-memory/  reset-dtc-investigation/
  chipA/level.json                平台：engine 改为 demo-vendor/log-v1(覆盖产品的 vector)
  chipA/reset-reasons/            平台级 skill
  chipA/customerB/level.json      项目：conf 改为 sample.nvmlayout.json(覆盖产品的 conf)
  chipA/customerB/sample-blocks/  项目级 skill
```

准备：先 `npm run compile`，再 `node server/demo/sync-engines.mjs`，生成 `vector/fee-v3`。不运行也能启动，只是安装 `radar` 时会提示 vector 引擎和描述文件 "not on the server"。

试一下：

1. `server\demo\start.cmd`(其他电脑访问：先 `set NVM_ENGINE_SERVER_HOST=0.0.0.0`)。
2. VS Code：**NVM: Install from Server…** → 输入 `127.0.0.1`(或服务器 IP)→ 选择：
   - `雷达 Radar`：Vector 引擎 + struct 描述文件 + 4 个应用层 skills(真实 dump 用)；
   - `customerB application`：demo 引擎 + 示例描述文件 + 应用层 skills + chipA / customerB 的 skills。
3. 设置 `nvmstudio.nvm.allowExternalEngines = true`。
4. 选 customerB 时：把 `samples/basic-log/sample-nvm.mot` 拷到一个空文件夹里打开 → block 名为 ResetCounter / DtcMemory / Calibration / Odometer。

修改应用层 skill：改 `docs/features/skill-templates/` 后重新拷贝到 `skills/radar/`。完整说明见 `server/README.zh-CN.md`。
