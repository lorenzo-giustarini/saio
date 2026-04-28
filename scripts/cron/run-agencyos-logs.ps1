# V15.0 WS2-2C — Aggrega log AgencyOS plugin runtime daily.
# Tar.gz dei log → vault/logs/agency-os/<YYYY-MM-DD>.tar.gz
# Cleanup file > 30gg.

$ErrorActionPreference = 'Continue'

$agencyOsLogs = if ($env:SAIO_AGENCYOS_LOGS_DIR) { $env:SAIO_AGENCYOS_LOGS_DIR } else { Join-Path $env:USERPROFILE 'Desktop\CLAUDE WORLD\AgencyOS\.claude\logs' }
$vaultDir = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs\agency-os'
$today = Get-Date -Format 'yyyy-MM-dd'
$tarFile = Join-Path $vaultDir "$today.tar.gz"
$logFile = Join-Path (Split-Path $vaultDir -Parent) "_run-agencyos-logs-$(Get-Date -Format 'yyyyMMdd').log"

if (!(Test-Path $vaultDir)) { New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null }

"[$(Get-Date -Format 'o')] Run start" | Add-Content $logFile

if (!(Test-Path $agencyOsLogs)) {
    "[$(Get-Date -Format 'o')] AgencyOS logs dir not found: $agencyOsLogs" | Add-Content $logFile
    exit 0
}

$logSize = (Get-ChildItem $agencyOsLogs -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
"[$(Get-Date -Format 'o')] AgencyOS logs size: $([math]::Round($logSize, 2)) MB" | Add-Content $logFile

if ($logSize -gt 500) {
    "[$(Get-Date -Format 'o')] WARN size > 500MB, skip pack to avoid bloat. Manual cleanup needed." | Add-Content $logFile
    exit 0
}

# Tar.gz tramite tar nativo Windows (Win10+)
try {
    Push-Location (Split-Path $agencyOsLogs -Parent)
    & tar.exe -czf $tarFile -C "$agencyOsLogs\.." "logs" 2>&1 | Add-Content $logFile
    Pop-Location

    if (Test-Path $tarFile) {
        $tarSize = (Get-Item $tarFile).Length / 1MB
        "[$(Get-Date -Format 'o')] OK packed $([math]::Round($tarSize, 2)) MB to $tarFile" | Add-Content $logFile
    }
} catch {
    "[$(Get-Date -Format 'o')] FAIL: $($_.Exception.Message)" | Add-Content $logFile
    exit 1
}

# Cleanup file >30gg
$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem $vaultDir -Filter "*.tar.gz" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        "[$(Get-Date -Format 'o')] Cleanup old: $($_.Name)" | Add-Content $logFile
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }

"[$(Get-Date -Format 'o')] Run done" | Add-Content $logFile
exit 0
