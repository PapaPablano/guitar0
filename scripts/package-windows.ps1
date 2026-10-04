param(
  [string]$OutputRoot = "dist-desktop",
  [string]$PackageName = "TabHighway-Windows-x64",
  [switch]$SkipShell
)

# Assembles the Tab Highway Windows desktop package: the shell, the pinned StemDeck engine, and the
# wrapper that makes the engine reachable. Needs Node, Rust and `cargo install tauri-cli --version "^2"`.
# See docs/desktop-packaging.md.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Stage = Join-Path $Root "$OutputRoot\$PackageName"
$Cache = Join-Path $Root "$OutputRoot\cache"

function Read-Version {
  $values = @{}
  Get-Content (Join-Path $Root "engine\stemdeck.version") | ForEach-Object {
    if ($_ -match "^\s*([a-z]+)\s*=\s*(.+?)\s*$") { $values[$Matches[1]] = $Matches[2] }
  }
  foreach ($key in "tag", "asset", "repo") {
    if (-not $values.ContainsKey($key)) { throw "engine/stemdeck.version is missing '$key'" }
  }
  return $values
}

$Version = Read-Version
New-Item -ItemType Directory -Force $Cache | Out-Null

# 1. Web build and shell.
Push-Location $Root
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
  if (-not $SkipShell) {
    cargo tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed" }
  }
} finally { Pop-Location }

# 2. The pinned StemDeck release, verified against the checksum it publishes.
$Base = "https://github.com/$($Version.repo)/releases/download/$($Version.tag)"
$Zip = Join-Path $Cache "$($Version.tag)-$($Version.asset)"
if (-not (Test-Path $Zip)) {
  Invoke-WebRequest "$Base/$($Version.asset)" -OutFile $Zip
}
$Published = (Invoke-WebRequest "$Base/$($Version.asset).sha256").Content.ToString().Trim().Split()[0].ToLower()
$Actual = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower()
if ($Published -ne $Actual) {
  Remove-Item -Force $Zip
  throw "StemDeck $($Version.tag) failed its published checksum"
}

$Unpacked = Join-Path $Cache "stemdeck-$($Version.tag)"
if (Test-Path $Unpacked) { Remove-Item -Recurse -Force $Unpacked }
Expand-Archive $Zip -DestinationPath $Unpacked
$Inner = Get-ChildItem $Unpacked | Where-Object { $_.PSIsContainer -and (Test-Path (Join-Path $_.FullName "python")) } | Select-Object -First 1
if (-not $Inner) { $Inner = Get-Item $Unpacked }
foreach ($dir in "python", "backend") {
  if (-not (Test-Path (Join-Path $Inner.FullName $dir))) { throw "StemDeck package has no '$dir' folder" }
}

# 3. Stage the package.
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item -Recurse (Join-Path $Inner.FullName "python") (Join-Path $Stage "python")
Copy-Item -Recurse (Join-Path $Inner.FullName "backend") (Join-Path $Stage "backend")
Copy-Item -Recurse (Join-Path $Root "engine\wrapper") (Join-Path $Stage "engine")
$Exe = Join-Path $Root "src-tauri\target\release\tab-highway.exe"
if (-not $SkipShell) {
  if (-not (Test-Path $Exe)) { throw "shell build not found at $Exe" }
  Copy-Item $Exe (Join-Path $Stage "TabHighway.exe")
}
Copy-Item (Join-Path $Root "THIRD_PARTY_NOTICES.md") (Join-Path $Stage "THIRD_PARTY_NOTICES.md")
Copy-Item (Join-Path $Root "packaging\windows\THIRD_PARTY_NOTICES.md") (Join-Path $Stage "THIRD_PARTY_NOTICES-desktop.md")
$StemDeckNotices = Join-Path $Inner.FullName "THIRD_PARTY_NOTICES.txt"
if (Test-Path $StemDeckNotices) {
  Copy-Item $StemDeckNotices (Join-Path $Stage "THIRD_PARTY_NOTICES-stemdeck.txt")
}
New-Item -ItemType Directory -Force (Join-Path $Stage "data") | Out-Null

Write-Host "Package : $Stage"
Write-Host "StemDeck: $($Version.tag)"
