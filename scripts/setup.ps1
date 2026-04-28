# RM Dashboard Setup Script
# V14.27 — wrapper che esegue bootstrap-check.ps1 in modalità "force-prompt"
# (chiede conferma anche se tutto è già installato, utile per re-setup esplicito).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot/..

Write-Host "RM Dashboard setup (manual run)" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Per setup automatico al primo avvio: usa direttamente 'pwsh scripts/dev.ps1'" -ForegroundColor Gray
Write-Host "Questo script forza il check anche se tutto e' gia' configurato." -ForegroundColor Gray
Write-Host ""

# Cancello state file per forzare re-check completo
$StateFile = Join-Path (Get-Location) 'data\.setup-state.json'
if (Test-Path $StateFile) {
    Remove-Item $StateFile -Force
    Write-Host "  state file rimosso, re-check forzato" -ForegroundColor Gray
}

& "$PSScriptRoot\bootstrap-check.ps1"
$rc = $LASTEXITCODE

if ($rc -eq 0) {
    Write-Host ""
    Write-Host "Setup OK. Avvio: pwsh scripts/dev.ps1" -ForegroundColor Green
}
exit $rc
