# NVM Studio Install Server

Serves engine packs, layout descriptors and skills to the extension, organised so the extension can install
exactly what one product / platform / project needs. Dependency-free Node (≥ 18). Chinese step-by-step guide:
[README.zh-CN.md](README.zh-CN.md).

## Quick start

`server/demo/` is a ready-to-run data root:

```
server\demo\start.cmd          # or: sh server/demo/start.sh
```

`npm run compile` also produces `dist/server/` (server + `data/` = the demo plus the engine packs built into
`dist/engines`) — copy that folder to a machine and run `start-nvm-engine-install-server.cmd`. Set
`NVM_ENGINE_SERVER_HOST=0.0.0.0` to accept other machines. In VS Code run
**NVM: Install from Server (Project Engines + Configs + Skills)…** and enter the server's IP.

## Data root

```
<root>/
  engines/<vendor>/[<layout>/]engine.json + entry   engine id = folder path, e.g. "vector/fee-v3"
  engines/<vendor>/vendor.json                       optional { title, description }
  conf/**/*.nvmlayout.json                           project descriptors, addressed by relative path
  skills/<product>/<platform>/<project>/<skill>/SKILL.md
  skills/<…level…>/level.json                        { title, description, engine, conf } — project binding
```

- **Engines** are grouped by AUTOSAR vendor, then by layout version. A folder with `engine.json` is a pack (max two
  levels). The release version lives in `engine.json` (`version`); publishing replaces the folder. A pack's
  `engine.json` `id` remains usable as a legacy reference (`"engine": "vector-fee-v3"`).
  `node server/demo/sync-engines.mjs [root]` copies the packs built in this repo into their vendor/layout folders.
- **Updating a deployed server without losing its own definitions:** run `server/sync-from-dist.ps1` from the server folder (`-DryRun` first). It calls `server/sync-server.mjs`. Only what `server/publish.json` lists is published (engine packs + the engine conf files named there, and the `server/demo` paths in `data`); the rest of `server/demo` (chipA sample, demo-vendor engine) stays a local demo. Server code is always synced. Engine packs and server code are always updated (edited copies are backed up). `conf/` and `skills/` are merged: new files are added, files unchanged since the last sync are updated, and files edited on the server are kept and reported as conflicts (`-Force <relPath>` replaces them after a backup). Nothing is deleted, and `.nvmsyncignore` paths are never written. State is kept in `<server>/.nvmsync.json`.
- **Descriptors** reference an engine by its folder path (`"engine": "vector/fee-v3"`) and may declare
  `"skillContext"`.
- **Project binding**: a level's `level.json` may set `"engine"` (string or array) and `"conf"` (paths under
  `conf/`). Fields are inherited down the hierarchy; the nearest level that sets a field wins. Installing a project
  installs its bound engines and descriptors, descriptors that declare that project as `skillContext`, every engine
  those descriptors reference, and the skills visible in the project; the project then becomes the skill context.
- **Skills**: a folder holding `SKILL.md` is a skill, any other folder is a level (max three). Names only need to be
  unique inside one folder; Unicode names are fine. Skills are data (they reach AI prompts, they are never executed).

## Routes

| Method | Path | |
| --- | --- | --- |
| GET | `/health` | status + data root |
| GET | `/v1/engines` | `{ engines: [{ id, vendor, layout, manifestId, version, displayName, description, sdkVersion, files }], vendors }` |
| GET | `/v1/engines/file?engine={id}&path={rel}` | one pack file |
| POST | `/v1/admin/engines?engine={id}` | publish / replace; `{ "files": { "engine.json": "…", … } }` or `{ "engineScript", "version", "displayName", "description", "sdkVersion", "id" }` |
| GET | `/v1/configs` | `{ configs: [{ path, name, vendor, engines, skillContext, downloadUrl }] }` |
| GET | `/v1/configs/file?path={rel}` | one descriptor |
| GET | `/v1/skills` | `{ skills: [{ id, name, path, level, kind, description, version, files }], levels: [{ path, level, title, description, engines, configs }] }` |
| GET | `/v1/skills/file?skill={id}&path={rel}` | one skill file |
| POST | `/v1/admin/skills?skill={id}` | publish / replace; `{ "files": { "SKILL.md": "…", … } }` |

Admin routes need header `x-api-token` = `NVM_ENGINE_SERVER_ADMIN_TOKEN`. Every path from a request is validated and
confined to its folder; a publish validates all files before writing and never replaces a vendor / level folder.

## Environment variables

- `NVM_ENGINE_SERVER_HOST` default `127.0.0.1`
- `NVM_ENGINE_SERVER_PORT` default `7788`
- `NVM_ENGINE_REGISTRY_HOME` data root, default the current directory (`dist/server` scripts use `./data`)
- `NVM_ENGINE_SERVER_ADMIN_TOKEN` required for admin publish routes
- `NVM_ENGINE_SERVER_TARGET` optional pkg target for the exe build, default `node18-win-x64`
- `NVM_ENGINE_SERVER_SKIP_EXE=1` skip the exe in `node server/build-server.mjs`

## Build output

`npm run compile` / `npm run package:vsix` generate `dist/server/` (`nvm-engine-install-server.js` + route modules,
`start-nvm-engine-install-server.cmd`, `nvm-engine-install-server.exe`, `data/`). Excluded from the VSIX by
`.vscodeignore`. An existing `dist/server/data/` is kept (only engine packs are re-synced), so a server's own content
survives rebuilds.
