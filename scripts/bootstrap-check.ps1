# RM Dashboard — bootstrap auto-check al primo avvio
# Verifica setup state e propone wizard se mancante.
# Idempotente: se tutto già configurato, exit silente.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot/..

$StateFile = Join-Path (Get-Location) 'data\.setup-state.json'
$Version = 'V14.27'

function Read-State {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile -Raw | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
    }
    return $null
}

function Write-State($checks) {
    $dir = Split-Path $StateFile -Parent
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    @{
        version     = $Version
        completedAt = (Get-Date).ToString('o')
        checks      = $checks
    } | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8
}

function Test-NodeDeps { Test-Path 'node_modules\react' }
function Test-PythonDeps {
    if (!(Test-Path 'orchestrator\requirements.txt')) { return $true }  # no python project, skip
    try {
        $null = python -c "import psutil, watchdog" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}
function Test-CronManager {
    $null = & schtasks.exe /query /tn 'RM-Saio-Tauri-Elevator' 2>$null
    return ($LASTEXITCODE -eq 0)
}

$state = Read-State
$cachedOk = $null -ne $state -and $state.version -eq $Version

# Live re-check: anche se state.json dice OK, valido lo stato reale (potrebbe essere stato cancellato).
$missing = @()
if (-not (Test-NodeDeps)) { $missing += 'node-deps' }
if (-not (Test-PythonDeps)) { $missing += 'python-deps' }
if (-not (Test-CronManager)) { $missing += 'cron-manager' }

if ($missing.Count -eq 0) {
    if (-not $cachedOk) { Write-State @('node-deps', 'python-deps', 'cron-manager') }
    exit 0
}

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " RM Dashboard - Setup richiesto" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Componenti mancanti:" -ForegroundColor Yellow
foreach ($m in $missing) {
    $label = switch ($m) {
        'node-deps' { 'Dipendenze Node (npm install)' }
        'python-deps' { 'Dipendenze Python orchestrator (pip install)' }
        'cron-manager' { 'Cron Manager (UAC popup richiesto UNA SOLA VOLTA)' }
        default { $m }
    }
    Write-Host "  - $label" -ForegroundColor Yellow
}
Write-Host ""

$ans = Read-Host "Vuoi configurare ora? (s/n)"
if ($ans -ne 's' -and $ans -ne 'S' -and $ans -ne 'y' -and $ans -ne 'Y') {
    Write-Host "Setup saltato. Avvio dashboard senza configurare i mancanti." -ForegroundColor Yellow
    Write-Host "Per riprovare: pwsh scripts/bootstrap-check.ps1" -ForegroundColor Gray
    Write-Host ""
    exit 0
}

# Esegui step in ordine
$completed = @()

if ('node-deps' -in $missing) {
    Write-Host ""
    Write-Host "[1] npm install..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install FALLITO" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Node deps installed" -ForegroundColor Green
    $completed += 'node-deps'
}

if ('python-deps' -in $missing) {
    Write-Host ""
    Write-Host "[2] pip install orchestrator deps..." -ForegroundColor Cyan
    python -m pip install --quiet -r orchestrator/requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  pip install FALLITO (continuo, orchestrator opzionale)" -ForegroundColor Yellow
    } else {
        Write-Host "  Python deps installed" -ForegroundColor Green
        $completed += 'python-deps'
    }
}

if ('cron-manager' -in $missing) {
    Write-Host ""
    Write-Host "[3] Registrazione Cron Manager (UAC popup tra qualche secondo)..." -ForegroundColor Cyan
    $elevatorScript = Join-Path $PSScriptRoot 'elevator.ps1'
    if (!(Test-Path $elevatorScript)) {
        Write-Host "  ERRORE: elevator.ps1 non trovato in $elevatorScript" -ForegroundColor Red
        exit 1
    }
    $tr = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$elevatorScript`""
    # Stop-parsing token + variabile interpolata
    $user = $env:USERNAME
    Write-Host "  Tra poco vedrai il popup UAC: clicca SI per autorizzare." -ForegroundColor Gray
    $argList = @('/create', '/tn', 'RM-Saio-Tauri-Elevator', '/tr', $tr, '/sc', 'ONCE', '/st', '23:59', '/sd', '01/01/2099', '/ru', $user, '/rl', 'HIGHEST', '/f')
    try {
        $p = Start-Process -FilePath schtasks.exe -ArgumentList $argList -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        if ($null -eq $p -or $p.ExitCode -ne 0) {
            Write-Host "  Registrazione fallita o annullata (UAC=No?)" -ForegroundColor Red
            Write-Host "  Per riprovare: pwsh scripts/bootstrap-check.ps1" -ForegroundColor Gray
            exit 1
        }
        Start-Sleep -Seconds 1
        if (Test-CronManager) {
            Write-Host "  Cron Manager registrato (zero UAC d'ora in poi)" -ForegroundColor Green
            $completed += 'cron-manager'
        } else {
            Write-Host "  Anomalia: Start-Process OK ma task non rilevato" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Eccezione: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# V14.28 Step 5 — Auto-trigger registrazione cron T4 se Cron-Manager appena registrato
if ('cron-manager' -in $completed) {
    Write-Host ""
    Write-Host "Registering cron T4 (multi-VPS + recipe builder)..." -ForegroundColor Cyan
    $registerScript = Join-Path $PSScriptRoot 'cron\register-cron-t4.ps1'
    if (Test-Path $registerScript) {
        & pwsh -ExecutionPolicy Bypass -File $registerScript
        if ($LASTEXITCODE -eq 0) {
            $completed += 'cron-t4'
            Write-Host "  Cron T4 registered" -ForegroundColor Green
        } else {
            Write-Host "  Cron T4 registration partial. Riprova: pwsh scripts/cron/register-cron-t4.ps1" -ForegroundColor Yellow
        }
    }
}

# Persist state
Write-State $completed

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Green
Write-Host " Setup completato. Avvio dashboard..." -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Green
Write-Host ""
exit 0
