param(
  [string]$Dest = "",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if (-not $Dest) {
  if ($env:DSH_HOME) {
    $Dest = Join-Path $env:DSH_HOME "plugins-data\aurabot\modules"
  } else {
    $Dest = Join-Path $env:USERPROFILE ".dsh\plugins-data\aurabot\modules"
  }
}

$target = Join-Path $Dest "linkparse"
$source = $PSScriptRoot

Write-Host "Aurabot module: linkparse"
Write-Host "Destination dir: $Dest"

if ($Uninstall) {
  if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
    Write-Host "Removed: $target"
  } else {
    Write-Host "Not installed: $target"
  }
  exit 0
}

if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
}

# Back up the previous copy OUTSIDE the modules dir: Aurabot loads every folder
# under modules/ and a folder named "linkparse.bak-*" would fail to load.
if (Test-Path (Join-Path $target "index.mjs")) {
  $backupRoot = Join-Path $Dest ".aurabot-backup"
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path $backupRoot ("linkparse-" + $stamp)
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Copy-Item (Join-Path $target "*.mjs") $backup -Force
  Write-Host "Backed up previous copy to: $backup"
}

# Copy in place (do not move the folder: the running Aurabot reloader watches it).
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $source "index.mjs") $target -Force
Copy-Item (Join-Path $source "parse.mjs") $target -Force

$installed = Join-Path $target "index.mjs"
if (-not (Test-Path $installed)) {
  throw "Install failed: index.mjs missing after copy"
}

Write-Host "Installed to: $target"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Aurabot hot-reloads modules within a few seconds (no Harness restart)."
Write-Host "  2. Check the Extensions tab: a running entry named 'linkparse' should appear."
Write-Host "  3. Optional: install ffmpeg only if you need m3u8 merging."
Write-Host ""
Write-Host "Settings: panel -> Extensions -> linkparse (link-parse)."
