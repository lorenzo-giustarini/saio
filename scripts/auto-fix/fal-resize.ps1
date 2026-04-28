# @safe
# @timeout=30
# @description=Auto-fix per fal.ai timeout su size >2048px - logga raccomandazione resize
# @rollback=

# Seed script V14.28 — no-op che logga la situazione e suggerisce manualmente
# il resize a 1024px nei progetti che usano fal.ai con immagini grandi.
# In futuro: sostituire con fix automatico (cerca file di config con size, riduce a 1024).

param(
    [string]$VpsId = "unknown",
    [string]$Pattern = "fal.ai timeout >2048px"
)

$ErrorActionPreference = 'Stop'

Write-Output "[fal-resize] Triggered for VPS=$VpsId pattern=$Pattern"
Write-Output "[fal-resize] Action: log raccomandazione (no-op safe)"
Write-Output "[fal-resize] Recommendation: cerca config fal.ai nei progetti, riduci size a 1024px max"

# Esempio futuro: cerca config files
# $configs = Get-ChildItem -Path "$env:USERPROFILE\Desktop" -Recurse -Filter "*.config.ts" -ErrorAction SilentlyContinue |
#     Select-String -Pattern "size:\s*\d{4,}" |
#     Select-Object -First 5
# foreach ($c in $configs) {
#     Write-Output "  - $($c.Path):$($c.LineNumber) $($c.Line.Trim())"
# }

Write-Output "[fal-resize] Done. Manual review consigliato."
exit 0
