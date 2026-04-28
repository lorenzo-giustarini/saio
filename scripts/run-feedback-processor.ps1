# V14.19 — Feedback AI processor (cron daily 03:00)
# Chiama backend POST /api/metrics/feedback/process-all (job async).
# Logga avvio + esito polling (max 5 min wait).

$ErrorActionPreference = "Continue"
$DashboardRoot = Split-Path -Parent $PSScriptRoot
$LogDir        = Join-Path $DashboardRoot "data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile   = Join-Path $LogDir "feedback-processor-$timestamp.log"

"=== Feedback AI Processor $timestamp ===" | Out-File $logFile -Encoding utf8
"Start: $(Get-Date)" | Out-File $logFile -Append -Encoding utf8

$backend = "http://127.0.0.1:3031"

# Pre-check backend up
try {
    $health = Invoke-RestMethod -Uri "$backend/api/projects/" -Method Get -TimeoutSec 5
    "Backend OK" | Out-File $logFile -Append -Encoding utf8
} catch {
    "ERROR: Backend non raggiungibile a $backend (Dashboard non avviata?)" | Out-File $logFile -Append -Encoding utf8
    "Detail: $($_.Exception.Message)" | Out-File $logFile -Append -Encoding utf8
    exit 1
}

# Avvia job
try {
    $start = Invoke-RestMethod -Uri "$backend/api/metrics/feedback/process-all" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 10
    "Job started: $($start.jobId), queued: $($start.queued)" | Out-File $logFile -Append -Encoding utf8
} catch {
    "ERROR avvio job: $($_.Exception.Message)" | Out-File $logFile -Append -Encoding utf8
    exit 1
}

# Polling status (max 5 min, ogni 5s)
$maxWait = 300
$elapsed = 0
$status = "running"
while ($elapsed -lt $maxWait -and ($status -eq "running" -or $status -eq "queued")) {
    Start-Sleep -Seconds 5
    $elapsed += 5
    try {
        $stat = Invoke-RestMethod -Uri "$backend/api/metrics/feedback/process-status" -Method Get -TimeoutSec 5
        $status = $stat.status
        "[t=${elapsed}s] status=$status processed=$($stat.processed) errors=$($stat.errors) total=$($stat.total)" | Out-File $logFile -Append -Encoding utf8
    } catch {
        "Polling error: $($_.Exception.Message)" | Out-File $logFile -Append -Encoding utf8
    }
}

if ($status -eq "done") {
    "DONE: brief=$($stat.briefPath) processed=$($stat.processed) errors=$($stat.errors)" | Out-File $logFile -Append -Encoding utf8
    exit 0
} elseif ($status -eq "error") {
    "ERROR: $($stat.errorMessage)" | Out-File $logFile -Append -Encoding utf8
    exit 1
} else {
    "TIMEOUT after ${maxWait}s, status=$status" | Out-File $logFile -Append -Encoding utf8
    exit 2
}
