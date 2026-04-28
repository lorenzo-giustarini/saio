# V15.0 WS4 — Cloudflare Tunnel + Access setup script
#
# Crea un Cloudflare Tunnel `saio-dashboard` che inoltra HTTPS pubblico a
# 127.0.0.1:3031 (backend Express). Richiede:
#   - cloudflared installato (winget install Cloudflare.cloudflared)
#   - account Cloudflare con dominio attivo
#   - hostname target (es. saio.tuodominio.com) con DNS gestito da Cloudflare
#
# Se vuoi un secondo strato di sicurezza pre-claim, configura una Cloudflare
# Access policy email-allowlist DOPO il claim (vedi README sezione Auth).

$ErrorActionPreference = 'Stop'

param(
  [string]$Hostname = '',
  [string]$TunnelName = 'saio-dashboard',
  [string]$BackendUrl = 'http://127.0.0.1:3031'
)

# Risolvi cloudflared via PATH
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "ERROR: cloudflared not in PATH. Install:" -ForegroundColor Red
  Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor Yellow
  exit 1
}

if (-not $Hostname) {
  $Hostname = Read-Host "Public hostname (es. saio.tuodominio.com)"
}
if (-not $Hostname) {
  Write-Host "ERROR: hostname required" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Cloudflare Tunnel setup ===" -ForegroundColor Cyan
Write-Host "Tunnel name:  $TunnelName"
Write-Host "Hostname:     $Hostname"
Write-Host "Backend:      $BackendUrl"
Write-Host ""

# Step 1: login (apre browser per OAuth Cloudflare)
Write-Host "[1/5] Login to Cloudflare (browser will open)..." -ForegroundColor Yellow
& cloudflared tunnel login
if ($LASTEXITCODE -ne 0) { Write-Host "Login failed" -ForegroundColor Red; exit 1 }

# Step 2: create tunnel (idempotent: skip se già esiste)
Write-Host "[2/5] Creating tunnel '$TunnelName'..." -ForegroundColor Yellow
$existingList = & cloudflared tunnel list 2>&1
$alreadyExists = $existingList | Select-String -Pattern $TunnelName
if ($alreadyExists) {
  Write-Host "  Tunnel already exists, skipping create." -ForegroundColor Gray
} else {
  & cloudflared tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { Write-Host "Tunnel create failed" -ForegroundColor Red; exit 1 }
}

# Step 3: extract tunnel UUID
$listOut = & cloudflared tunnel list 2>&1
$tunnelLine = $listOut | Select-String -Pattern $TunnelName | Select-Object -First 1
if (-not $tunnelLine) {
  Write-Host "ERROR: cannot find tunnel '$TunnelName' in tunnel list" -ForegroundColor Red
  exit 1
}
$tunnelId = ($tunnelLine -split '\s+')[0]
Write-Host "  Tunnel UUID: $tunnelId" -ForegroundColor Gray

# Step 4: route DNS (idempotent)
Write-Host "[3/5] Routing DNS '$Hostname' -> tunnel..." -ForegroundColor Yellow
& cloudflared tunnel route dns $TunnelName $Hostname 2>&1 | Out-Host

# Step 5: write config.yml in $env:USERPROFILE\.cloudflared\
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
$configPath = Join-Path $cfDir 'config.yml'
$credentialsPath = Join-Path $cfDir "$tunnelId.json"

Write-Host "[4/5] Writing $configPath..." -ForegroundColor Yellow
$configYml = @"
tunnel: $tunnelId
credentials-file: $credentialsPath
ingress:
  - hostname: $Hostname
    service: $BackendUrl
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
  - service: http_status:404
"@
$configYml | Set-Content -Encoding UTF8 -Path $configPath
Write-Host "  config.yml written" -ForegroundColor Gray

# Step 6: print start commands
Write-Host ""
Write-Host "[5/5] Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "=== NEXT STEPS ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Configura .env.local in dashboard/:" -ForegroundColor White
Write-Host "   DASHBOARD_AUTH_TUNNEL_URL=https://$Hostname"
Write-Host ""
Write-Host "2. Avvia dashboard backend (in altro terminale):" -ForegroundColor White
Write-Host "   cd dashboard && npm run dev:server"
Write-Host ""
Write-Host "3. Avvia Cloudflare Tunnel:" -ForegroundColor White
Write-Host "   cloudflared tunnel run $TunnelName"
Write-Host ""
Write-Host "4. Apri https://$Hostname/claim?token=<TOKEN_DAL_LOG>" -ForegroundColor White
Write-Host ""
Write-Host "(Optional) Per servizio Windows persistente:" -ForegroundColor Gray
Write-Host "   cloudflared service install" -ForegroundColor Gray
Write-Host "   (cloudflared partira' automaticamente al boot Windows)" -ForegroundColor Gray
Write-Host ""
Write-Host "(Optional) Cloudflare Access policy (secondo strato):" -ForegroundColor Gray
Write-Host "   1. Cloudflare dashboard -> Zero Trust -> Access -> Applications" -ForegroundColor Gray
Write-Host "   2. Add Application -> Self-hosted -> $Hostname" -ForegroundColor Gray
Write-Host "   3. Policy: include emails [your-email@example.com]" -ForegroundColor Gray
Write-Host "   4. Save -> Cloudflare Access blocchera' chi non ha email autorizzata" -ForegroundColor Gray
Write-Host "      PRIMA che la request arrivi a SAIO (doppio strato)" -ForegroundColor Gray
Write-Host ""
