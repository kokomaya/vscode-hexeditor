# 生产环境：从 0 到解析 block

本手册覆盖生产环境完整流程：部署服务器 → 组织 engine / conf / skills → 插件按项目一键安装 → 打开 dump 解析出 block。

解析 block 需要三样东西同时到位：

1. 引擎(engine)：已安装,且描述文件里的 `engine` 能解析到它(`vector/fee-v3` 这种文件夹路径,或旧的 `vector-fee-v3` 清单 id)。
2. 描述文件(`*.nvmlayout.json`)：能被发现。
3. 描述文件声明的源文件(如 `Fee_Lcfg.c`、`*.h`、`*.arxml`)：能被发现。

前两样可以从服务器按项目一键安装；源文件属于项目工程,需在本地就位(第 4 步)。

---

## 第 0 步：前置条件

1. 桌面版 VS Code(非 web),工作区受信任(Workspace Trust)。
2. 设置 `nvmstudio.nvm.allowExternalEngines = true`(安装完成的提示里有直达按钮)。

---

## 第 1 步：部署服务器(5 分钟)

仓库里的 `server/demo/` 就是一个可以直接运行的数据根,照着它的结构放自己的内容即可：

```powershell
# 方式 A：直接用仓库源码
server\demo\start.cmd                  # Linux/macOS: sh server/demo/start.sh

# 方式 B：打包后部署(npm run compile 会生成 dist/server/,含 data/ = demo + 已构建的 vector 引擎)
#   把 dist/server 整个拷到服务器机器上：
start-nvm-engine-install-server.cmd    # 或 nvm-engine-install-server.exe(需自己设 NVM_ENGINE_REGISTRY_HOME)
```

让其他机器能访问：启动前设置 `NVM_ENGINE_SERVER_HOST=0.0.0.0`(并放通防火墙端口 7788)。
启动日志的 `Data root:` 必须指向包含 `engines/`、`conf/`、`skills/` 的目录。浏览器打开 `http://<IP>:7788/v1/engines` 能看到列表即部署成功。

环境变量：

- `NVM_ENGINE_SERVER_HOST` 默认 `127.0.0.1`(对外服务用 `0.0.0.0`)
- `NVM_ENGINE_SERVER_PORT` 默认 `7788`
- `NVM_ENGINE_REGISTRY_HOME` 数据根(默认启动目录；`start.cmd` 指向自己所在目录)
- `NVM_ENGINE_SERVER_ADMIN_TOKEN` 发布接口所需

---

## 第 2 步：组织数据根

```
<数据根>/
  engines/                                  按 AUTOSAR 供应商 → layout 版本 分类(代码)
    vector/
      vendor.json                           可选 { "title": "Vector MICROSAR" }
      fee-v3/  engine.json + 入口脚本        engine id = vector/fee-v3
      fee-v4/  …
    eb/
      engine.json + 入口脚本                 供应商只有一种 layout 时可以不分版本：id = eb
  conf/                                     项目的描述文件(数据),结构随意,建议与 skills 一致
    radar/chipA/customerB/customerB.nvmlayout.json
  skills/                                   产品 → 平台 → 项目(见第 6 步)
    radar/
      level.json
      chipA/
        level.json                          { "engine": "vector/fee-v3" }   平台绑定 engine
        customerB/
          level.json                        { "conf": ["radar/chipA/customerB/customerB.nvmlayout.json"] }
          <skill>/SKILL.md
```

### engines：供应商 / layout 版本

- 含 `engine.json` 的文件夹是一个引擎包,其他文件夹是供应商目录；最多两层(`<供应商>/<layout 版本>`)。
- 引擎的 id 就是文件夹路径,描述文件写 `"engine": "vector/fee-v3"`。
- 包的发布版本写在 `engine.json` 的 `version` 里；重新发布会整体替换该文件夹。
- `engine.json` 示例：

```json
{ "id": "vector-fee-v3", "version": "1.2.0", "displayName": "Vector FEE V3", "entry": "vectorFeeV3.engine.js", "sdkVersion": 4 }
```

  `id` 可选；保留旧 id(`vector-fee-v3`)时,旧描述文件里的 `"engine": "vector-fee-v3"` 仍然能解析。
- 仓库里构建出来的引擎用 `node server/demo/sync-engines.mjs [数据根]` 同步：包进 `engines/vector/fee-v3/`，引擎自带的标准描述文件进 `conf/vector/fee-v3/`；旧结构(`engines/vector-fee-v3/<版本>/`、`conf/vector*.nvmlayout.json`)会被清掉，其他 conf 不动。
- **更新已部署的服务器(保留服务器上的自定义)**:把 `server/sync-from-dist.ps1` 放到服务器目录(`nvm-engine-install-server.js` 和 `data` 所在处)运行，先用 `-DryRun` 看计划。它调用 `server/sync-server.mjs`。**只发布 `server/publish.json` 列出的内容**(引擎包及其中点名的引擎 conf 文件，以及 `data` 里列出的 `server/demo` 路径)；`server/demo` 其余内容(chipA 示例、demo-vendor 引擎)只留在工程里做本地 demo。服务器代码总是同步。引擎包和服务器代码总是更新(服务器上改过的先备份到 `backup\sync-<时间>`)；`conf`、`skills` 按合并规则——新增文件直接加，上次同步后没改过的才更新，服务器上改过的**保留**并列为冲突(`-Force <相对路径>` 才替换，替换前备份)；从不删除；`.nvmsyncignore` 里列出的路径从不写入。同步记录在服务器目录的 `.nvmsync.json`。

### conf：项目描述文件

- `conf/` 下任意层级的 `*.nvmlayout.json`,按相对路径寻址。
- 描述文件里写 `"engine"`(用哪个引擎)和可选的 `"skillContext": "radar/chipA/customerB"`。

### 项目绑定：`level.json`

每个 产品/平台/项目 文件夹可以放一个 `level.json`,告诉插件这一层用哪个引擎、哪些描述文件：

```jsonc
{
  "title": "customerB 应用项目",          // 显示名称,可用中文
  "description": "…",
  "engine": "vector/fee-v3",             // 字符串或数组；engines/ 下的路径
  "conf": ["radar/chipA/customerB/customerB.nvmlayout.json"]   // conf/ 下的路径
}
```

- **向下继承,最近的一层生效**(按字段)：平台写了 `engine`,其下所有项目都用它；某个项目另写 `engine` 就覆盖平台的。
- 插件安装某个项目时会装：绑定的引擎 + 绑定的描述文件 + `skillContext` 等于该项目的描述文件 + 这些描述文件引用的引擎 + 该项目可见的 skills。

---

## 第 3 步：VS Code 按项目一键安装

1. 命令面板执行 **NVM: Install from Server (Project Engines + Configs + Skills)…**
2. 输入服务器地址：直接写 IP 即可(`10.1.2.3` → `http://10.1.2.3:7788`),也可以写 `host:端口` 或完整 URL；上次的地址会被记住。
3. 选择你做的 产品 / 平台 / 项目(每行显示它会装的引擎、conf 数和 skill 数),或 "Everything on the server"。
4. 确认引擎安装(引擎是代码,统一一次确认)。
5. 完成后：
   - 引擎在 `%USERPROFILE%\nvmstudio\engines\<供应商>\<版本>\`；
   - 描述文件在 `%USERPROFILE%\nvmstudio\conf\<同服务器路径>`,所在文件夹自动加入 `nvmstudio.nvm.layoutRoots`；
   - skills 在 `%USERPROFILE%\nvmstudio\skills\…`；
   - 所选项目自动成为 skill 上下文(`nvmstudio.nvm.skills.context`)。

统一用户目录可用环境变量 `NVMSTUDIO_HOME` 覆盖。单独安装的命令仍然可用：`NVM: Install Layout Configs from URL…`(全部描述文件)、`NVM: Install Skills from Server…`、`NVM: Install Engine…`(本地包)。
`NVM: Manage Engines` 列出已安装引擎(显示 `供应商/版本`)并可删除。

---

## 第 4 步：源文件(描述文件 `sources` 声明的文件)

描述文件的发现路径(命中其一即可)：dump 所在目录、`./conf`、`../conf`、`nvmstudio.nvm.layoutRoots`(第 3 步已自动配置)。

源文件发现路径：

1. dump 目录 / `./conf` / `../conf`
2. 设置 `nvmstudio.nvm.workspaceRoots` 里配置的目录(递归查找)

```jsonc
"nvmstudio.nvm.workspaceRoots": [
  "${workspaceFolder}/src/DaVinci/ARS620_S2A2_EM_B2_2CAN"
]
```

- `layoutRoots`：放描述文件(全局目录,可在工作区外)
- `workspaceRoots`：找源文件(项目目录,工作区内)
- dump 目录 / `./conf` / `../conf`：永远自动扫描,不用配

---

## 第 5 步：打开 dump 并验证

1. 打开 dump 文件(hex 编辑器)。
2. 首次运行引擎会弹安全确认,选择 Run once 或 Always run this file。
3. 若配置正确,block 会被解析并着色,NVM Studio 视图里显示 block 列表。

用 demo 验证：部署 `server/demo` 后安装 `radar › chipA › customerB`,把 `samples/basic-log/sample-nvm.mot` 拷到一个空文件夹打开,block 名应为 ResetCounter / DtcMemory / Calibration / Odometer(来自项目描述文件,引擎本身不含项目知识)。

---

## 第 6 步：skills 的层级

skills 放在 `<数据根>/skills/` 下,**只用文件夹分类**：

```
skills/
  general-tip/SKILL.md                               通用
  radar/                                             产品(雷达、摄像头…)
    level.json                                       可选：title / description / engine / conf
    reset-counter/SKILL.md                           产品级
    chipA/                                           平台(芯片平台 / 芯片变种)
      reset-counter/SKILL.md                         平台级
      customerB/                                     项目(客户应用项目)
        reset-counter/SKILL.md                       项目级
```

- 含 `SKILL.md` 的文件夹是 skill,其他文件夹是层级,最多三层；名字只需在同一个文件夹内唯一,文件夹名可以用中文。
- 生效范围：上下文所在文件夹及所有上层文件夹的 skill + 通用 skill；重名时离上下文最近的生效。
- skill 只是数据(Markdown/JSON),服务器和插件都不会执行它,但它会进入 AI 提示词,只安装可信来源的 skill。

---

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 状态与数据根 |
| GET | `/v1/engines` | `{ engines: [{ id, vendor, layout, manifestId, version, displayName, description, sdkVersion, files }], vendors }` |
| GET | `/v1/engines/file?engine=<id>&path=<文件>` | 引擎包里的一个文件 |
| POST | `/v1/admin/engines?engine=<id>` | 发布/替换(`x-api-token`)。body `{ "files": { "engine.json": "…", "x.js": "…" } }` 或 `{ "engineScript": "…", "version", "displayName", "sdkVersion", "id" }` |
| GET | `/v1/configs` | `{ configs: [{ path, name, vendor, engines, skillContext, downloadUrl }] }` |
| GET | `/v1/configs/file?path=<相对路径>` | 一个描述文件 |
| GET | `/v1/skills` | `{ skills: [...], levels: [{ path, level, title, description, engines, configs }] }` |
| GET | `/v1/skills/file?skill=<id>&path=<文件>` | skill 的一个文件 |
| POST | `/v1/admin/skills?skill=<id>` | 发布/替换 skill(`x-api-token`),body `{ "files": { "SKILL.md": "…" } }` |

发布时先校验全部路径再写入；不会覆盖供应商/层级文件夹,也不允许把 skill 放进另一个 skill。所有请求路径都限制在数据根内。

发布示例：

```powershell
$headers = @{ "x-api-token" = "your-token" }
$body = @{ engineScript = (Get-Content -Raw .\vectorFeeV3.engine.js); version = "1.2.0"; displayName = "Vector FEE V3"; sdkVersion = 4 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:7788/v1/admin/engines?engine=vector/fee-v3" -Headers $headers -ContentType "application/json" -Body $body
```

---

## 常见问题

- 装了引擎仍解析不出 block：描述文件的 `engine` 解析不到已安装的引擎。用 `NVM: Manage Engines` 看已安装的 `供应商/版本`,描述文件写同样的路径(或该包 `engine.json` 里的 `id`)。
- 配置“没被识别”：多数是引擎没解析出来的表象。先确认引擎能解析到、描述文件与源文件都能被发现。
- 安装时列表为空 / 404：服务数据根没指向包含 `engines/`、`conf/`、`skills/` 的目录,用 `NVM_ENGINE_REGISTRY_HOME` 显式指定后重启服务。
- 别的电脑连不上：服务默认只监听 `127.0.0.1`,设 `NVM_ENGINE_SERVER_HOST=0.0.0.0` 并放通端口。
- 安装某个项目时提示 "not on the server"：`level.json` 里写的引擎或 conf 路径在服务器上不存在,检查拼写和文件夹。
- 旧版插件：接口路径已改为 `?engine=` / `?path=` / `?skill=` 查询参数,需要同时升级插件和服务器。
- 改了服务代码不生效：重启服务进程；改了扩展代码：Developer: Reload Window(或重装 VSIX)。
