# V15.0 WS10 — SAIO dependencies setup (Windows)
# Detect + auto-install: Node, Python 3.11+, Claude CLI, VS Build Tools, pip deps,
# Playwright (opzionale).
#
# Uso:
#   pwsh scripts/setup-deps.ps1                  # interattivo
#   pwsh scripts/setup-deps.ps1 -AutoYes         # accetta tutto senza prompt
#   pwsh scripts/setup-deps.ps1 -CheckOnly       # solo report, no install
#
# Skip globale: env SAIO_SKIP_DEPS_CHECK=true (utile in CI)

param(
  [switch]$AutoYes,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

if ($env:SAIO_SKIP_DEPS_CHECK -eq 'true') {
  Write-Host '[setup-deps] SAIO_SKIP_DEPS_CHECK=true → skip' -ForegroundColor Gray
  exit 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptDir

Write-Host ''
Write-Host '═══════════════════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  SAIO DASHBOARD — Dependency Check & Auto-Install (Windows)' -ForegroundColor Cyan
Write-Host '═══════════════════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

# ─────────────── Detection ───────────────

function Test-CommandExists {
  param([string]$Cmd)
  $null = Get-Command $Cmd -ErrorAction SilentlyContinue
  return $?
}

function Get-ToolVersion {
  param([string]$Cmd, [string]$Args = '--version')
  try {
    $out = & $Cmd $Args 2>&1 | Select-Object -First 1
    return $out
  } catch {
    return $null
  }
}

$report = [ordered]@{
  Node            = @{ Required = $true;  Found = $false; Version = ''; Category = 'CRITICAL' }
  Npm             = @{ Required = $true;  Found = $false; Version = ''; Category = 'CRITICAL' }
  Python          = @{ Required = $true;  Found = $false; Version = ''; Category = 'CORE' }
  Pip             = @{ Required = $true;  Found = $false; Version = ''; Category = 'CORE' }
  ClaudeCli       = @{ Required = $true;  Found = $false; Version = ''; Category = 'CRITICAL' }
  VsBuildTools    = @{ Required = $false; Found = $false; Version = ''; Category = 'CORE'; Note = 'Solo se npm install fallisce su node-pty' }
  Playwright      = @{ Required = $false; Found = $false; Version = ''; Category = 'OPTIONAL' }
  Cloudflared     = @{ Required = $false; Found = $false; Version = ''; Category = 'OPTIONAL'; Note = 'Solo per esposizione pubblica' }
}

# Node
if (Test-CommandExists 'node') {
  $report.Node.Found = $true
  $report.Node.Version = (Get-ToolVersion 'node').Trim()
}
# npm
if (Test-CommandExists 'npm') {
  $report.Npm.Found = $true
  $report.Npm.Version = (Get-ToolVersion 'npm').Trim()
}
# Python (preferisci python3.11+, fallback python)
foreach ($pyCmd in @('python', 'py', 'python3')) {
  if (Test-CommandExists $pyCmd) {
    $v = (Get-ToolVersion $pyCmd '--version' 2>&1) -replace 'Python\s*', ''
    $major, $minor = ($v -split '\.')[0..1]
    if ([int]$major -ge 3 -and [int]$minor -ge 11) {
      $report.Python.Found = $true
      $report.Python.Version = "Python $v ($pyCmd)"
      break
    }
  }
}
# pip
if (Test-CommandExists 'pip') {
  $report.Pip.Found = $true
  $report.Pip.Version = (Get-ToolVersion 'pip').Trim()
}
# Claude CLI
if (Test-CommandExists 'claude') {
  $report.ClaudeCli.Found = $true
  $report.ClaudeCli.Version = (Get-ToolVersion 'claude').Trim()
}
# VS Build Tools (presenza di cl.exe nel PATH è proxy)
if (Test-CommandExists 'cl' -or (Test-Path 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools')) {
  $report.VsBuildTools.Found = $true
  $report.VsBuildTools.Version = 'detected'
}
# Playwright
if (Test-Path (Join-Path $projectRoot 'node_modules/playwright')) {
  $report.Playwright.Found = $true
  $report.Playwright.Version = 'in node_modules'
}
# cloudflared
if (Test-CommandExists 'cloudflared') {
  $report.Cloudflared.Found = $true
  $report.Cloudflared.Version = (Get-ToolVersion 'cloudflared').Trim()
}

# ─────────────── Report ───────────────

Write-Host 'Stato dipendenze:' -ForegroundColor White
foreach ($key in $report.Keys) {
  $entry = $report[$key]
  $icon = if ($entry.Found) { '✓' } elseif ($entry.Required) { '✗' } else { '○' }
  $color = if ($entry.Found) { 'Green' } elseif ($entry.Required) { 'Red' } else { 'Yellow' }
  $version = if ($entry.Version) { "  ($($entry.Version))" } else { '' }
  Write-Host ("  {0} {1,-15} [{2}]{3}" -f $icon, $key, $entry.Category, $version) -ForegroundColor $color
  if ($entry.Note -and -not $entry.Found) { Write-Host ("       Note: $($entry.Note))") -ForegroundColor DarkGray }
}
Write-Host ''

# ─────────────── Auto-install ───────────────

if ($CheckOnly) {
  Write-Host '[setup-deps] Modalità CheckOnly — niente installazione' -ForegroundColor Yellow
  exit 0
}

$missingCritical = @($report.Keys | Where-Object { $report[$_].Required -and -not $report[$_].Found })
if ($missingCritical.Count -eq 0) {
  Write-Host '✓ Tutte le dipendenze critiche sono presenti.' -ForegroundColor Green
  Write-Host ''
  exit 0
}

Write-Host "⚠️ Mancano $($missingCritical.Count) dipendenze critiche: $($missingCritical -join ', ')" -ForegroundColor Yellow
Write-Host ''

if (-not $AutoYes) {
  $reply = Read-Host 'Vuoi installarle automaticamente via winget? [Y/n]'
  if ($reply -and $reply -notmatch '^[YySs]') {
    Write-Host ''
    Write-Host 'Installazione manuale:' -ForegroundColor White
    foreach ($dep in $missingCritical) {
      switch ($dep) {
        'Node'   { Write-Host '  winget install OpenJS.NodeJS.LTS' }
        'Python' { Write-Host '  winget install Python.Python.3.11' }
        'ClaudeCli' { Write-Host '  https://docs.anthropic.com/cli (manual install dal sito Anthropic)' }
      }
    }
    exit 0
  }
}

# winget check
if (-not (Test-CommandExists 'winget')) {
  Write-Host 'ERRORE: winget non disponibile. Installa Windows App Installer dal Microsoft Store.' -ForegroundColor Red
  exit 1
}

foreach ($dep in $missingCritical) {
  switch ($dep) {
    'Node' {
      Write-Host '→ Install Node.js LTS via winget...' -ForegroundColor Cyan
      winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    }
    'Python' {
      Write-Host '→ Install Python 3.11 via winget...' -ForegroundColor Cyan
      winget install Python.Python.3.11 --accept-source-agreements --accept-package-agreements
    }
    'ClaudeCli' {
      Write-Host '⚠️ Claude CLI deve essere installata manualmente dal sito Anthropic:' -ForegroundColor Yellow
      Write-Host '   https://docs.anthropic.com/cli' -ForegroundColor White
      Write-Host '   (poi assicurati che sia in PATH e ri-esegui questo script)' -ForegroundColor Gray
    }
  }
}

Write-Host ''
Write-Host 'Riavvia il terminale e ri-esegui questo script per la verifica finale.' -ForegroundColor Yellow
Write-Host ''

# Optional: Python deps
if ($report.Python.Found -and (Test-Path (Join-Path $projectRoot 'orchestrator/requirements.txt'))) {
  $venvPath = Join-Path $projectRoot 'orchestrator/.venv'
  if (-not (Test-Path $venvPath)) {
    if (-not $AutoYes) {
      $reply = Read-Host 'Vuoi creare venv Python e installare requirements.txt? [Y/n]'
      if ($reply -and $reply -notmatch '^[YySs]') { exit 0 }
    }
    Write-Host '→ Creazione venv...' -ForegroundColor Cyan
    & python -m venv $venvPath
    & "$venvPath\Scripts\python.exe" -m pip install --upgrade pip
    & "$venvPath\Scripts\pip.exe" install -r (Join-Path $projectRoot 'orchestrator/requirements.txt')
    Write-Host '✓ venv creato + requirements installati' -ForegroundColor Green
  }
}

Write-Host ''
Write-Host '✓ Setup completato. Lancia: npm run dev:all' -ForegroundColor Green
Write-Host ''
