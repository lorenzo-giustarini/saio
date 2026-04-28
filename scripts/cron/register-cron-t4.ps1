# V14.28 Step 5 — Registra i 6 cron T4 in Windows Task Scheduler via elevator (zero UAC).
# Idempotent: skip task già esistenti.

$ErrorActionPreference = 'Stop'
$dashboardRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$elevatorTaskName = 'RM-Saio-Tauri-Elevator'
$elevatorDir = Join-Path $dashboardRoot 'data\elevator'

# Check elevator esiste
$elevatorCheck = & schtasks.exe /query /tn $elevatorTaskName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Elevator task '$elevatorTaskName' non registrato." -ForegroundColor Red
    Write-Host "Esegui prima: pwsh dashboard/scripts/register-elevator.ps1" -ForegroundColor Yellow
    exit 1
}

if (!(Test-Path $elevatorDir)) { New-Item -ItemType Directory -Path $elevatorDir -Force | Out-Null }

function Invoke-Elevator {
    param([hashtable]$Cmd)
    $id = [guid]::NewGuid().ToString()
    $Cmd.id = $id
    $cmdFile = Join-Path $elevatorDir "cmd-$id.json"
    $resultFile = Join-Path $elevatorDir "result-$id.json"
    $Cmd | ConvertTo-Json -Depth 5 | Set-Content -Path $cmdFile -Encoding UTF8
    & schtasks.exe /run /tn $elevatorTaskName | Out-Null

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $resultFile) {
            $r = Get-Content $resultFile -Raw | ConvertFrom-Json
            Remove-Item $resultFile -Force -ErrorAction SilentlyContinue
            return $r
        }
        Start-Sleep -Milliseconds 200
    }
    return @{ ok = $false; error = 'elevator timeout 30s' }
}

# Definizione 6 cron T4
$crons = @(
    @{
        name        = 'Obsidian-VPS-Pull-Daily'
        scheduleType = 'DAILY'
        startTime   = '04:00'
        scriptPath  = 'scripts\cron\run-vps-pull.ps1'
        comment     = 'Pull logs ogni VPS via SSH (rsync ultime 24h)'
        details     = 'Cron multi-VPS. Per ogni VPS in registry: ssh + tar.gz delle ultime 24h log (syslog/PM2/agency-os logs) -> vault/logs/vps-pulls/<vpsId>/. Zero token AI, solo I/O.'
    },
    @{
        name        = 'Obsidian-VPS-Errors-Daily'
        scheduleType = 'DAILY'
        startTime   = '04:30'
        scriptPath  = 'scripts\cron\run-vps-errors.ps1'
        comment     = 'Error pipeline 4-layer su log VPS scaricati'
        details     = 'Trigger error-pipeline.ts mode=vps via API. Layer 1 SSH grep, Layer 2 known-fixes match, Layer 3 dedupe, Layer 4 AI classify (cap $0.50/giorno). Auto-fix dispatcher se cron toggle ON.'
    },
    @{
        name        = 'Obsidian-Providers-Errors-Hourly'
        scheduleType = 'DAILY'
        startTime   = '00:30'
        scriptPath  = 'scripts\cron\run-providers-errors.ps1'
        comment     = 'Error pipeline ogni ora su provider AI (fal.ai, Vercel, Namecheap, ecc.)'
        details     = 'Hourly error pipeline su log dei provider AI/PaaS. Filter SSH-side -> pattern noti -> dedupe -> AI classify nuovi. Auto-fix toggle UI per scegliere se applicare fix safe automatici.'
    },
    @{
        name        = 'Obsidian-Tools-Snapshot-Weekly'
        scheduleType = 'WEEKLY'
        dayOfWeek   = 'MON'
        startTime   = '06:00'
        scriptPath  = 'scripts\cron\run-tools-snapshot.ps1'
        comment     = 'Inventario settimanale tool installati (pip+npm+git remote)'
        details     = 'Lunedi mattina: snapshot pip list + npm list -g + git remote -v dei progetti locali. Output vault/inventory/tools-YYYY-W.md. Diff con settimana scorsa per spotting cambi.'
    },
    @{
        name        = 'Obsidian-Pattern-Adoption-Tracker'
        scheduleType = 'DAILY'
        startTime   = '02:30'
        scriptPath  = 'scripts\cron\run-pattern-adoption.ps1'
        comment     = 'Tracker adozione recipes (feedback loop self-learning)'
        details     = 'Per ogni atomic recipe esistente, scansiona jsonl Claude Code ultimi 30gg e cerca match del code snippet della working solution. >=2 match = adopted. Output vault/metrics/pattern-adoption-YYYY-MM.md.'
    },
    @{
        name        = 'Obsidian-Recipe-Builder-Daily'
        scheduleType = 'DAILY'
        startTime   = '03:00'
        scriptPath  = 'scripts\cron\run-recipe-builder.ps1'
        comment     = 'Recipe Builder: estrae anti-pattern + atomic recipes da sessioni Claude'
        details     = 'Daily 03:00 wrapper python build_recipes.py. Scansiona jsonl Claude Code ultime 24h da 3 progetti (CLAUDE-WORLD, AgencyOS, GSD). Estrae anti-pattern strutturali (Tipo 1) e atomic recipes (Tipo 2 con filtri stringenti). Cap budget AI $0.20/giorno.'
    }
)

Write-Host ""
Write-Host "Registering 6 cron T4 via elevator..." -ForegroundColor Cyan

$created = 0
$skipped = 0
$failed = 0

foreach ($c in $crons) {
    Write-Host ""
    Write-Host "[$($c.name)]" -ForegroundColor Yellow

    # Check exist
    & schtasks.exe /query /tn $c.name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SKIP - già esistente" -ForegroundColor Gray
        $skipped++
        continue
    }

    # taskCommand wraps powershell
    $taskCommand = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dashboardRoot\$($c.scriptPath)`""

    $createCmd = @{
        op           = 'create'
        taskName     = $c.name
        taskCommand  = $taskCommand
        scheduleType = $c.scheduleType
        startTime    = $c.startTime
    }
    if ($c.dayOfWeek) { $createCmd.dayOfWeek = $c.dayOfWeek }
    if ($c.comment) { $createCmd.comment = $c.comment }

    Write-Host "  CREATE..." -ForegroundColor Gray
    $r = Invoke-Elevator -Cmd $createCmd

    if ($r.ok) {
        Write-Host "  OK created" -ForegroundColor Green

        # Set comment via separate op (più affidabile)
        if ($c.comment) {
            $r2 = Invoke-Elevator -Cmd @{
                op = 'set-comment'
                taskName = $c.name
                comment = $c.comment
            }
            if ($r2.ok) {
                Write-Host "  + comment set" -ForegroundColor Gray
            }
        }
        $created++
    } else {
        Write-Host "  FAIL: $($r.error)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  Created: $created" -ForegroundColor Green
Write-Host "  Skipped: $skipped" -ForegroundColor Gray
Write-Host "  Failed:  $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Gray' })

if ($failed -gt 0) { exit 1 }
exit 0
