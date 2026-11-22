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

if (Test-Path $target) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = Join-Path $Dest ("linkparse.bak-" + $stamp)
  Move-Item -Path $target -Destination $backup
  Write-Host "Backed up previous copy to: $backup"
}

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
