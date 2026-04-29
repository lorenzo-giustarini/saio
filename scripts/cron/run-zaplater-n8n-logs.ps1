# V15.0 WS2-2D — Pull esecuzioni n8n con status=error daily.
# 1. SSH al VPS rm3-prod, recupera N8N_API_KEY da .env
# 2. Curl GET /api/v1/executions?status=error&limit=200&filter timestamp>24h
# 3. Salva JSONL in vault/logs/zaplater/<YYYY-MM-DD>.jsonl
# 4. Estrae top 10 error patterns in vault/errors/zaplater-<YYYY-MM-DD>.md

$ErrorActionPreference = 'Continue'

$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs\zaplater'
$vaultErrors = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\errors'
$today = Get-Date -Format 'yyyy-MM-dd'
$jsonlFile = Join-Path $vaultLogs "$today.jsonl"
$errMdFile = Join-Path $vaultErrors "zaplater-$today.md"
$runLog = Join-Path $vaultLogs "_run-$(Get-Date -Format 'yyyyMMdd').log"

if (!(Test-Path $vaultLogs)) { New-Item -ItemType Directory -Path $vaultLogs -Force | Out-Null }
if (!(Test-Path $vaultErrors)) { New-Item -ItemType Directory -Path $vaultErrors -Force | Out-Null }

"[$(Get-Date -Format 'o')] Run start" | Add-Content $runLog

# n8n endpoint + recupero API key via SSH
# Configurazione tramite env var (override) oppure default placeholder.
$n8nUrl = if ($env:SAIO_N8N_URL) { $env:SAIO_N8N_URL } else { 'https://n8n.example.com' }
$sshKey = if ($env:SAIO_VPS_SSH_KEY) { $env:SAIO_VPS_SSH_KEY } else { Join-Path $env:USERPROFILE '.ssh\saio_vps' }
$vpsHost = if ($env:SAIO_VPS_HOST) { $env:SAIO_VPS_HOST } else { 'root@vps.example.com' }

if (!(Test-Path $sshKey)) {
    "[$(Get-Date -Format 'o')] FAIL: SSH key not found at $sshKey" | Add-Content $runLog
    exit 1
}

# Recupera API key tramite SSH (eseguito nel terminale, non scritto in file)
try {
    $apiKey = & ssh -i $sshKey -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=accept-new $vpsHost "grep N8N_API_KEY /opt/onweb24/agency-os/.env 2>/dev/null | head -1 | cut -d= -f2-"
    $apiKey = $apiKey.Trim()
    if (!$apiKey) {
        "[$(Get-Date -Format 'o')] FAIL: N8N_API_KEY not found on VPS" | Add-Content $runLog
        exit 1
    }
} catch {
    "[$(Get-Date -Format 'o')] FAIL SSH: $($_.Exception.Message)" | Add-Content $runLog
    exit 1
}

# Fetch executions con status=error (in WSL/Windows curl funziona)
try {
    $resp = Invoke-RestMethod -Uri "$n8nUrl/api/v1/executions?status=error&limit=200" `
        -Headers @{ 'X-N8N-API-KEY' = $apiKey } `
        -TimeoutSec 60

    $executions = $resp.data
    if (!$executions) { $executions = @() }
    $count = $executions.Count

    "[$(Get-Date -Format 'o')] Fetched $count error executions" | Add-Content $runLog

    # Append JSONL
    foreach ($e in $executions) {
        ($e | ConvertTo-Json -Compress -Depth 6) | Add-Content $jsonlFile -Encoding UTF8
    }

    # Top errors summary
    $byWorkflow = $executions | Group-Object -Property workflowId | Sort-Object Count -Descending | Select-Object -First 10
    $mdLines = @(
        "# ZapLater N8N — Errori $today",
        "",
        "> Run: $(Get-Date -Format 'o')",
        "> Total error executions ultimo: $count",
        "",
        "## Top 10 workflow per errori",
        ""
    )
    foreach ($g in $byWorkflow) {
        $mdLines += "- $($g.Name) (workflowId): $($g.Count) errori"
    }
    $mdLines | Set-Content -Path $errMdFile -Encoding UTF8
    "[$(Get-Date -Format 'o')] OK summary written: $errMdFile" | Add-Content $runLog
} catch {
    "[$(Get-Date -Format 'o')] FAIL fetch: $($_.Exception.Message)" | Add-Content $runLog
    exit 1
}

"[$(Get-Date -Format 'o')] Run done" | Add-Content $runLog
exit 0
