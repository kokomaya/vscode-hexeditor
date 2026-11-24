# Merge-sync the vscode-hexeditor repo into THIS deployed install server, keeping
# the server's own definitions. Put this script next to the server (the folder
# holding nvm-engine-install-server.js and data\).
#
#   .\sync-from-dist.ps1 -DryRun                 # show what would change, write nothing
#   .\sync-from-dist.ps1                         # apply
#   .\sync-from-dist.ps1 -Force conf/radar/ARS620/ARS620CN15/x.nvmlayout.json   # replace a conflict
#
# Only what <repo>/server/publish.json lists is published (server/demo is a local
# demo otherwise). Built engine packs + server code are always updated (the old copy is backed up
# if it was edited here). conf\ and skills\ definitions are merged: new files are
# added, files untouched since the last sync are updated, files edited here are
# KEPT and reported as conflicts. Nothing is deleted. Paths listed in
# .nvmsyncignore (one per line) are never written. Logic: <repo>/server/sync-server.mjs.
#
# Build the repo first (npm run compile, or node .esbuild.config.js) so dist\engines is current.
param(
    [string]$Repo = "d:/02_Work/external_repo/microsoft/vscode-hexeditor",
    [string]$ServerDir = $PSScriptRoot,
    [switch]$DryRun,
    [string[]]$Force = @(),
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$sync = Join-Path $Repo "server/sync-server.mjs"

try {
    if (-not (Test-Path $sync)) {
        throw "Sync script not found: $sync  (pass -Repo <path to vscode-hexeditor>)"
    }
    if (-not (Test-Path (Join-Path $Repo "dist/engines"))) {
        throw "No build output in $Repo/dist/engines  (build the extension first: npm run compile)"
    }
    $argv = @($sync, $ServerDir)
    if ($DryRun) { $argv += "--dry-run" }
    foreach ($f in $Force) { $argv += @("--force", $f) }
    node @argv
    if ($LASTEXITCODE -ne 0) {
        throw "sync-server.mjs failed (exit $LASTEXITCODE)"
    }
}
finally {
    if (-not $NoPause) { Read-Host "Press Enter to exit" | Out-Null }
}
