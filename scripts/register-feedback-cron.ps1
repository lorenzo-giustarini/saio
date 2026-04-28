# V14.19 — Registra Windows Task Scheduler per Feedback AI Processor
# Schedule: daily 03:00, esegue run-feedback-processor.ps1
# Run as: utente corrente, hidden, retry-on-failure 3x

$ErrorActionPreference = "Stop"

$TaskName = "RM-Dashboard-Feedback-AI"
$ScriptPath = Join-Path $PSScriptRoot "run-feedback-processor.ps1"

if (-not (Test-Path $ScriptPath)) {
    Write-Error "Script non trovato: $ScriptPath"
    exit 1
}

# Rimuovi task esistente se presente
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Task '$TaskName' esistente — rimuovo per re-registrazione."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "03:00"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "SAIO Dashboard — Feedback AI 2-step processor (V14.19). Legge feedback non processati, genera brief decisioni in Inbox."

Write-Host "OK: Task '$TaskName' registrato (daily 03:00)."
Write-Host "Verifica con: schtasks /Query /TN `"$TaskName`""
Write-Host "Run manuale: schtasks /Run /TN `"$TaskName`""
