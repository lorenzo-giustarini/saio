# @safe
# @timeout=10
# @description=Auto-fix per Postgres deadlock - logga raccomandazione retry tx

# Seed script V14.28 — no-op safe demo. Il fix vero richiederebbe accesso al DB
# (e troppi side-effect). Qui solo logga la raccomandazione.

param(
    [string]$VpsId = "unknown",
    [string]$Pattern = "Postgres deadlock"
)

$ErrorActionPreference = 'Stop'

Write-Output "[postgres-retry-tx] Triggered for VPS=$VpsId pattern=$Pattern"
Write-Output "[postgres-retry-tx] Action: logga deadlock evento (no-op safe)"

$logFile = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'data\audit\postgres-deadlocks.jsonl'
$logDir = Split-Path $logFile -Parent
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$entry = @{
    ts             = (Get-Date -Format 'o')
    vpsId          = $VpsId
    pattern        = $Pattern
    recommendation = 'Retry tx with exponential backoff. If recurring, investigate long-locking queries.'
} | ConvertTo-Json -Compress

Add-Content -Path $logFile -Value $entry -Encoding UTF8

Write-Output "[postgres-retry-tx] Logged in $logFile"
Write-Output "[postgres-retry-tx] Done."
exit 0
