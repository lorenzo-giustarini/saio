# Register RM-Dashboard autostart task (Windows Task Scheduler)
# Runs dev.ps1 at user login, hidden window, recover on fail

param(
    [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$TaskName = 'RM-Dashboard-Autostart'
$ScriptPath = Join-Path $PSScriptRoot 'dev.ps1'
$LogPath = Join-Path $PSScriptRoot '..\data\logs\autostart.log'

if ($Unregister) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "Task '$TaskName' rimosso" -ForegroundColor Green
    } catch {
        Write-Host "Task '$TaskName' non esisteva" -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $ScriptPath)) {
    Write-Host "ERROR: dev.ps1 non trovato in $ScriptPath" -ForegroundColor Red
    exit 1
}

# Check if pwsh is available, fall back to powershell
$ShellExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }

$Action = New-ScheduledTaskAction `
    -Execute $ShellExe `
    -Argument "-NoProfile -WindowStyle Hidden -File `"$ScriptPath`"" `
    -WorkingDirectory (Join-Path $PSScriptRoot '..')

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)  # unlimited

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Unregister old if exists
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}

$null = Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description '✨ RM Dashboard Operativa — cruscotto decisioni + orchestrator sessioni Claude. Avvia Vite (3030) + Express (3031) al login. Dashboard: http://127.0.0.1:3030'

Write-Host ""
Write-Host "Task '$TaskName' registrato" -ForegroundColor Green
Write-Host "  Trigger:     Login utente $env:USERNAME" -ForegroundColor Gray
Write-Host "  Action:      $ShellExe dev.ps1 (finestra hidden)" -ForegroundColor Gray
Write-Host "  Restart:     3 tentativi, 1 min intervallo" -ForegroundColor Gray
Write-Host "  Timeout:     nessuno" -ForegroundColor Gray
Write-Host ""
Write-Host "Dashboard sempre raggiungibile su http://127.0.0.1:3030 dopo il prossimo login" -ForegroundColor Cyan
Write-Host ""
Write-Host "Per rimuovere:  pwsh $PSCommandPath -Unregister" -ForegroundColor DarkGray
