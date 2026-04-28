# check-vite-cache.ps1 - Pre-dev validator per Vite deps cache (V15.4 WS34)
#
# Scansiona node_modules/.vite/deps/*.js per NULL byte prefix (corruzione classica
# su Windows da kill durante optimizeDeps). Se trova file corrotti, fa auto-clear
# della cache cosi' il prossimo `npm run dev` ricostruisce pulito.
#
# Eseguito automaticamente da package.json `predev` script.
# Plan: eventual-baking-bentley.md (V15.4 WS34).

$ErrorActionPreference = 'Continue'
$ViteCacheDir = Join-Path $PSScriptRoot '..\node_modules\.vite\deps'

if (-not (Test-Path $ViteCacheDir)) {
    Write-Host "[vite-cache] cache non esistente, skip check (Vite la creera' al boot)"
    exit 0
}

$jsFiles = Get-ChildItem -LiteralPath $ViteCacheDir -Filter '*.js' -ErrorAction SilentlyContinue
if (-not $jsFiles -or $jsFiles.Count -eq 0) {
    Write-Host "[vite-cache] cache vuota, OK"
    exit 0
}

$corrupted = @()
foreach ($f in $jsFiles) {
    try {
        # Read first 16 bytes RAW (no encoding interpretation)
        $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
        if ($bytes.Length -lt 4) { continue }
        # Check: primo byte e' NULL? Oppure piu' di 4 NULL nei primi 16?
        $head = $bytes[0..([Math]::Min(15, $bytes.Length - 1))]
        $nullCount = ($head | Where-Object { $_ -eq 0 }).Count
        if ($head[0] -eq 0 -or $nullCount -ge 8) {
            $corrupted += $f.Name
        }
    } catch {
        # File irraggiungibile, ignora
    }
}

if ($corrupted.Count -gt 0) {
    Write-Host "[vite-cache] CORRUZIONE rilevata in $($corrupted.Count) file:" -ForegroundColor Yellow
    foreach ($name in ($corrupted | Select-Object -First 5)) {
        Write-Host "  - $name" -ForegroundColor Yellow
    }
    if ($corrupted.Count -gt 5) {
        Write-Host "  ... e altri $($corrupted.Count - 5) file" -ForegroundColor Yellow
    }
    Write-Host "[vite-cache] AUTO-CLEAR cache..." -ForegroundColor Cyan
    $cacheRoot = Join-Path $PSScriptRoot '..\node_modules\.vite'
    Remove-Item -Recurse -Force $cacheRoot -ErrorAction SilentlyContinue
    Write-Host "[vite-cache] cache pulita, Vite ricostruira' al prossimo dev" -ForegroundColor Green
} else {
    Write-Host "[vite-cache] $($jsFiles.Count) file OK, no corruption"
}

exit 0
