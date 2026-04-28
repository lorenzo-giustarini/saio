# V14.28 Step 5 — Trigger error-pipeline mode=vps via dashboard API.

$ErrorActionPreference = 'Stop'

$dashboardRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tokenFile = Join-Path $dashboardRoot 'data\.cron-token'
$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs'
$today = Get-Date -Format 'yyyyMMdd'
$logFile = Join-Path $vaultLogs "cron-vps-errors-$today.log"

if (!(Test-Path $tokenFile)) {
    "[$(Get-Date -Format 'o')] ERROR: token file mancante: $tokenFile. Avvia almeno una volta la dashboard per generarlo." | Add-Content $logFile
    Write-Output "Token file non trovato. Avvia la dashboard."
    exit 1
}

$token = (Get-Content $tokenFile -Raw).Trim()
$body = @{ mode = 'vps' } | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3031/api/error-pipeline/run' `
        -Method POST `
        -Headers @{ 'X-Cron-Token' = $token; 'Content-Type' = 'application/json' } `
        -Body $body `
        -TimeoutSec 300

    "[$(Get-Date -Format 'o')] OK raw=$($resp.totalRaw) agg=$($resp.totalAggregates) new=$($resp.totalNew) cost=`$$($resp.totalAiCostUsd)" | Add-Content $logFile
    Write-Output "VPS errors: $($resp.totalRaw) raw -> $($resp.totalAggregates) aggregates ($($resp.totalNew) new)"
} catch {
    "[$(Get-Date -Format 'o')] FAIL: $($_.Exception.Message)" | Add-Content $logFile
    Write-Output "Failed: $($_.Exception.Message)"
    exit 1
}
exit 0
