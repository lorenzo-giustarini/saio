# RM Dashboard dev server (concurrent Vite + Express)
# V14.27 — auto-detect setup mancante e propone wizard prima di avviare.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot/..

# Bootstrap auto-check: se setup incompleto, propone wizard interattivo.
# Se completo, exit silenzioso e prosegue con dev:all.
& "$PSScriptRoot\bootstrap-check.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Bootstrap fallito. Risolvi gli errori sopra e riprova." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Starting RM Dashboard dev..." -ForegroundColor Cyan
Write-Host "  Vite:    http://127.0.0.1:3030" -ForegroundColor Gray
Write-Host "  Express: http://127.0.0.1:3031" -ForegroundColor Gray
Write-Host "  Ctrl+C per uscire" -ForegroundColor Gray
Write-Host ""

npm run dev:all
