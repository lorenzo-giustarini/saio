# V15.0 WS2-2E — Pull log OnWeb24 (Portal + Supabase Edge Functions + Workflows) daily.
# Sources:
# - Portal/agency-os: già coperti da run-vps-pull (no duplicare)
# - Supabase Edge Functions: via Supabase CLI (richiede SUPABASE_ACCESS_TOKEN env)
# - Workflows scripts locali: Desktop/CLAUDE WORLD/onweb24-dev/

$ErrorActionPreference = 'Continue'

$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs\onweb24'
$today = Get-Date -Format 'yyyy-MM-dd'
$todayDir = Join-Path $vaultLogs $today
$runLog = Join-Path $vaultLogs "_run-$(Get-Date -Format 'yyyyMMdd').log"

if (!(Test-Path $todayDir)) { New-Item -ItemType Directory -Path $todayDir -Force | Out-Null }

"[$(Get-Date -Format 'o')] Run start" | Add-Content $runLog

# 1) Supabase Edge Functions logs (via CLI)
$supabaseToken = $env:SUPABASE_ACCESS_TOKEN
if ($supabaseToken) {
    try {
        & supabase functions logs --project-ref onweb24 --limit 200 2>&1 | Out-File -FilePath (Join-Path $todayDir "supabase-edge-functions.log") -Encoding UTF8
        "[$(Get-Date -Format 'o')] Supabase Edge Functions logs OK" | Add-Content $runLog
    } catch {
        "[$(Get-Date -Format 'o')] Supabase CLI fail: $($_.Exception.Message)" | Add-Content $runLog
    }
} else {
    "[$(Get-Date -Format 'o')] SUPABASE_ACCESS_TOKEN missing, skip Supabase logs" | Add-Content $runLog
}

# 2) Workflows local logs (se presenti)
$workflowsDir = if ($env:SAIO_ONWEB24_DEV_DIR) { $env:SAIO_ONWEB24_DEV_DIR } else { Join-Path $env:USERPROFILE 'Desktop\CLAUDE WORLD\onweb24-dev' }
if (Test-Path $workflowsDir) {
    Get-ChildItem -Path $workflowsDir -Recurse -Filter "*.log" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) } |
        Select-Object -First 50 |
        ForEach-Object {
            try {
                $relName = $_.FullName.Replace($workflowsDir, '').Replace('\', '_').TrimStart('_')
                $destFile = Join-Path $todayDir "workflows-$relName"
                Copy-Item -Path $_.FullName -Destination $destFile -Force
            } catch { /* skip */ }
        }
    "[$(Get-Date -Format 'o')] Workflows logs collected" | Add-Content $runLog
}

# 3) Note: Portal su VPS è già pullato da run-vps-pull.ps1 V14.28+2F
"[$(Get-Date -Format 'o')] Run done" | Add-Content $runLog
exit 0
