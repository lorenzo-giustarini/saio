# V15.0 WS4 — Avvia Cloudflare Tunnel in foreground.
# Usalo quando vuoi monitorare il tunnel. Per persistenza Windows, usa
# `cloudflared service install` invece (vedi cloudflare-tunnel-setup.ps1).

param(
  [string]$TunnelName = 'saio-dashboard'
)

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "cloudflared not in PATH. Run cloudflare-tunnel-setup.ps1 first." -ForegroundColor Red
  exit 1
}

Write-Host "Starting tunnel '$TunnelName' (Ctrl+C to stop)..." -ForegroundColor Cyan
& cloudflared tunnel run $TunnelName
