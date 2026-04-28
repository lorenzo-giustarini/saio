# Register Windows Task Scheduler for MCP Discovery weekly
param([switch]$Unregister)

$ErrorActionPreference = 'Stop'
$TaskName = 'MCP-Discovery-Weekly'
$ScriptPath = Join-Path $PSScriptRoot '..\orchestrator\mcp_discovery.py'

if ($Unregister) {
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop; Write-Host "Removed $TaskName" -ForegroundColor Green }
    catch { Write-Host "Task '$TaskName' didn't exist" -ForegroundColor Yellow }
    exit 0
}

$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) { Write-Host "python not in PATH" -ForegroundColor Red; exit 1 }

$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument "`"$ScriptPath`"" -WorkingDirectory (Join-Path $PSScriptRoot '..')
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4:00am
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {}

$null = Register-ScheduledTask `
    -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
    -Description 'MCP Discovery - scansiona weekly GitHub/smithery per proposte MCP utili, output vault/research/'

Write-Host "Task '$TaskName' registrato (Domenica 04:00)" -ForegroundColor Green
