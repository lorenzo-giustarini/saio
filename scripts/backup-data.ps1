# Backup snapshot of data/ before bulk operations

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot/..

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$src = Join-Path $PWD 'data'
$dst = Join-Path $PWD "backups/data-$ts"

if (-not (Test-Path $src)) {
    Write-Host "data/ does not exist, nothing to backup" -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path "$src/*" -Destination $dst -Recurse -Force

$size = (Get-ChildItem $dst -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Host "Backup saved: $dst ($([math]::Round($size/1KB,1)) KB)" -ForegroundColor Green
