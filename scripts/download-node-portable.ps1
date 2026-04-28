# scripts/download-node-portable.ps1
# Downloads Node 20 LTS portable Windows x64 binary and places it
# at src-tauri/binaries/node-x86_64-pc-windows-msvc.exe for Tauri externalBin.
#
# Run: pwsh scripts/download-node-portable.ps1
# Idempotent: skips download if file already exists with correct size.

$ErrorActionPreference = 'Stop'
$nodeVer = '20.18.1'
$url = "https://nodejs.org/dist/v$nodeVer/node-v$nodeVer-win-x64.zip"
$repoRoot = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repoRoot 'src-tauri\binaries\node-x86_64-pc-windows-msvc.exe'

if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 60MB) {
    Write-Host "Node portable already exists at $dest (skip download)" -ForegroundColor Green
    & $dest --version
    exit 0
}

$zip = "$env:TEMP\saio-node-portable-$nodeVer.zip"
$extract = "$env:TEMP\saio-node-portable-$nodeVer-extracted"

if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 20MB) {
    Write-Host "Downloading Node $nodeVer Windows x64 from $url..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}

Write-Host "Extracting..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $extract

$exe = Get-ChildItem -Path $extract -Recurse -Filter 'node.exe' | Select-Object -First 1
if (-not $exe) { throw "node.exe not found in extracted archive" }

New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
Copy-Item $exe.FullName -Destination $dest -Force
Write-Host "Copied node.exe ($([Math]::Round($exe.Length / 1MB, 2)) MB) to $dest" -ForegroundColor Green
& $dest --version

# Cleanup tmp extraction (keep zip for cache)
Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue
