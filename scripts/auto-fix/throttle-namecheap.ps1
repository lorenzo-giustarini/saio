# @safe
# @timeout=15
# @description=Auto-fix per Namecheap rate-limit - logga raccomandazione throttle

# Seed script V14.28 — no-op che logga la situazione.
# In futuro: scrivere un flag in data/ che il prossimo script che chiama Namecheap
# rispetta come throttle hint.

param(
    [string]$VpsId = "unknown",
    [string]$Pattern = "Namecheap rate-limit"
)

$ErrorActionPreference = 'Stop'

Write-Output "[throttle-namecheap] Triggered for VPS=$VpsId pattern=$Pattern"
Write-Output "[throttle-namecheap] Action: scrivo throttle hint (no-op safe)"

$hintFile = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'data\namecheap-throttle.flag'
$ts = Get-Date -Format 'o'
@{
    triggeredAt = $ts
    vpsId       = $VpsId
    backoffSec  = 60
    until       = (Get-Date).AddMinutes(15).ToString('o')
} | ConvertTo-Json | Set-Content -Path $hintFile -Encoding UTF8

Write-Output "[throttle-namecheap] Throttle flag scritto: $hintFile"
Write-Output "[throttle-namecheap] Done. Next Namecheap calls dovranno rispettare backoff fino a 15 min."
exit 0
