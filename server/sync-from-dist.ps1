# Sync the engine packs built in the vscode-hexeditor repo (dist/engines) into
# this server's data root. Put this script next to the server: the data root is
# ./data when that folder exists (dist/server layout), else the script's own
# folder (engines/, conf/, skills/ beside it). -DataRoot overrides both.
# dist is the single source of truth — do NOT hand-edit the synced folders. Edit engines/<pack>/** in the repo, rebuild
# (`npm run compile` or `node .esbuild.config.js`), then re-run this script.
#
#   engines/vector/fee-v3/             engine pack (engine.json + bundle, as built)
#   conf/vector/fee-v3/*.nvmlayout.json the engine's standard descriptors
#
# Old layout leftovers (engines/vector-fee-v3/<version>/, conf/vector*.nvmlayout.json)
# are removed. The logic lives in <repo>/server/demo/sync-engines.mjs (shared with
# the repo demo and the dist/server build), so this script only calls it.
param(
    [string]$Repo = "d:/02_Work/external_repo/microsoft/vscode-hexeditor",
    [string]$DataRoot = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$dataRoot = if ($DataRoot) { $DataRoot } elseif (Test-Path (Join-Path $PSScriptRoot "data")) { Join-Path $PSScriptRoot "data" } else { $PSScriptRoot }
$sync = Join-Path $Repo "server/demo/sync-engines.mjs"

try {
    if (-not (Test-Path $sync)) {
        throw "Sync script not found: $sync  (pass -Repo <path to vscode-hexeditor>)"
    }
    if (-not (Test-Path (Join-Path $Repo "dist/engines"))) {
        throw "No build output in $Repo/dist/engines  (build the extension first: npm run compile)"
    }
    node $sync $dataRoot
    if ($LASTEXITCODE -ne 0) {
        throw "sync-engines.mjs failed (exit $LASTEXITCODE)"
    }
}
finally {
    if (-not $NoPause) { Read-Host "Press Enter to exit" | Out-Null }
}
