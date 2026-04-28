# Setup one-shot: registra il task RM-Saio-Tauri-Elevator
# Da eseguire UNA VOLTA SOLA con UAC. Dopo, la dashboard non chiede più UAC per le op cron.

$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
# V15.9 WS39: usa elevator-windows.ps1 dedicato saio-tauri (legacy elevator.ps1
# eliminato dopo refactor PAL).
$ElevatorScript = Join-Path $ScriptRoot 'elevator-windows.ps1'
if (!(Test-Path $ElevatorScript)) {
    # Fallback al vecchio nome se rinominato non ancora
    $ElevatorScript = Join-Path $ScriptRoot 'elevator.ps1'
}
$TaskName = 'RM-Saio-Tauri-Elevator'

if (!(Test-Path $ElevatorScript)) {
    Write-Host "ERROR: elevator.ps1 not found at: $ElevatorScript" -ForegroundColor Red
    exit 1
}

Write-Host "Registering Cron Manager task..." -ForegroundColor Cyan
Write-Host "  Task name: $TaskName" -ForegroundColor Gray
Write-Host "  Runner:    $ElevatorScript" -ForegroundColor Gray
Write-Host "  Run as:    $env:USERNAME (current user, highest privileges)" -ForegroundColor Gray
Write-Host ""

$tr = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ElevatorScript`""

# Verifica admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')
if (!$isAdmin) {
    Write-Host "Re-launching with elevation (UAC popup)..." -ForegroundColor Yellow
    $argList = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    Start-Process -FilePath powershell.exe -ArgumentList $argList -Verb RunAs -Wait
    exit $LASTEXITCODE
}

# Crea il task
& schtasks.exe /create `
    /tn $TaskName `
    /tr $tr `
    /sc ONCE `
    /st '23:59' `
    /sd '01/01/2099' `
    /ru $env:USERNAME `
    /rl HIGHEST `
    /f 2>&1 | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "OK Task registrato. Da ora la dashboard NON chiedera piu UAC per:" -ForegroundColor Green
    Write-Host "    enable, disable, run, create, delete, rename" -ForegroundColor Green
    Write-Host ""
    Write-Host "Test: schtasks /run /tn $TaskName (deve eseguire senza popup)" -ForegroundColor Gray
} else {
    Write-Host "FAIL Registration failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}
