# V14.28 Step 5 — VPS log pull daily 04:00.
# Per ogni VPS in registry: rsync -e ssh logs ultime 24h verso <vault>/logs/vps-pulls/<vpsId>/

$ErrorActionPreference = 'Continue'  # non bloccare se 1 VPS non raggiungibile

$dashboardRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$inventoryFile = Join-Path $dashboardRoot 'data\ssh-inventory.json'
$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs\vps-pulls'
$today = Get-Date -Format 'yyyyMMdd'

if (!(Test-Path $inventoryFile)) {
    Write-Output "ssh-inventory.json non trovato, skip"
    exit 0
}

if (!(Test-Path $vaultLogs)) {
    New-Item -ItemType Directory -Path $vaultLogs -Force | Out-Null
}

$inv = Get-Content $inventoryFile -Raw | ConvertFrom-Json
$vps = $inv.vps

$logFile = Join-Path $vaultLogs "_run-$today.log"
"=== Run $(Get-Date -Format 'o') ===" | Add-Content $logFile

foreach ($v in $vps) {
    $vpsDir = Join-Path $vaultLogs $v.id
    if (!(Test-Path $vpsDir)) { New-Item -ItemType Directory -Path $vpsDir -Force | Out-Null }
    $sshKey = Join-Path $env:USERPROFILE ".ssh\$($v.keyName)"
    if (!(Test-Path $sshKey)) {
        "[$($v.id)] SKIP - chiave SSH non trovata: $sshKey" | Add-Content $logFile
        continue
    }

    # V15.0 WS2-2F — pull esteso: include n8n logs, nginx access/error,
    # cron config snapshot, package list (per inventory tracking).
    # 2>/dev/null per ignorare path inesistenti (n8n può mancare su alcune VPS).
    $remoteCmd = "tar czf - " +
        "/var/log/syslog " +
        "/var/log/messages " +
        "/var/log/nginx/access.log " +
        "/var/log/nginx/error.log " +
        "/var/log/n8n/*.log " +
        "/opt/onweb24/agency-os/logs/*.log " +
        "/root/.pm2/logs/*.log " +
        "/etc/cron.d 2>/dev/null"
    $localFile = Join-Path $vpsDir "$today.tar.gz"

    try {
        & ssh -i $sshKey -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "root@$($v.ip)" $remoteCmd 2>$null | Set-Content -Path $localFile -AsByteStream
        $sizeMB = [math]::Round((Get-Item $localFile).Length / 1MB, 2)
        "[$($v.id)] OK pulled $sizeMB MB to $localFile" | Add-Content $logFile
        Write-Output "[$($v.id)] $sizeMB MB"
    } catch {
        "[$($v.id)] FAIL: $($_.Exception.Message)" | Add-Content $logFile
        Write-Output "[$($v.id)] FAIL"
    }
}

"=== Run done $(Get-Date -Format 'o') ===" | Add-Content $logFile
exit 0
