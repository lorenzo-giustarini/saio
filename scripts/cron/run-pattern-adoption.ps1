# V14.28 Step 5 — Pattern adoption tracker daily 02:30.

$ErrorActionPreference = 'Stop'

$dashboardRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tokenFile = Join-Path $dashboardRoot 'data\.cron-token'
$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs'
$today = Get-Date -Format 'yyyyMMdd'
$logFile = Join-Path $vaultLogs "cron-pattern-adoption-$today.log"

if (!(Test-Path $tokenFile)) { exit 1 }
$token = (Get-Content $tokenFile -Raw).Trim()

try {
    $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3031/api/pattern-adoption/run' `
        -Method POST `
        -Headers @{ 'X-Cron-Token' = $token; 'Content-Type' = 'application/json' } `
        -TimeoutSec 240

    "[$(Get-Date -Format 'o')] OK scanned=$($resp.recipesScanned) adopted=$($resp.adoptedCount) pending=$($resp.pendingCount)" | Add-Content $logFile
} catch {
    "[$(Get-Date -Format 'o')] FAIL: $($_.Exception.Message)" | Add-Content $logFile
    exit 1
}
exit 0
