# RM-Dashboard-Cron-Manager — Elevated runner per operazioni schtasks
# Eseguito dal task scheduler con /rl HIGHEST → no UAC popup quando l'utente proprietario lo trigga via /run.
# Whitelist op: enable, disable, run, create, delete, rename, export-xml, create-from-xml, set-comment.

$ErrorActionPreference = 'Stop'
$DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\elevator'
$LogFile = Join-Path $DataDir 'elevator.log'

function Write-ElevLog {
    param([string]$msg, [string]$level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    "$ts [$level] $msg" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

if (!(Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Cerca il file cmd-*.json più recente (max 30s di età)
$cmdFile = Get-ChildItem -Path $DataDir -Filter 'cmd-*.json' -ErrorAction SilentlyContinue |
    Where-Object { (New-TimeSpan -Start $_.LastWriteTime -End (Get-Date)).TotalSeconds -lt 30 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (!$cmdFile) {
    Write-ElevLog "no cmd file found within 30s window" 'WARN'
    exit 0
}

Write-ElevLog "processing: $($cmdFile.Name)"

try {
    $cmd = Get-Content $cmdFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-ElevLog "cmd parse failed: $($_.Exception.Message)" 'ERROR'
    exit 1
}

$resultFile = Join-Path $DataDir "result-$($cmd.id).json"

function Write-Result {
    param($obj)
    $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $resultFile -Encoding UTF8
}

# Whitelist op
$allowedOps = @('enable', 'disable', 'run', 'create', 'delete', 'rename', 'export-xml', 'create-from-xml', 'set-comment', 'winget-upgrade')
if ($cmd.op -notin $allowedOps) {
    Write-ElevLog "op not allowed: $($cmd.op)" 'ERROR'
    Write-Result @{ id = $cmd.id; ok = $false; error = "op not allowed: $($cmd.op)" }
    Remove-Item $cmdFile.FullName -Force
    exit 1
}

# Validazione taskName
if ($cmd.taskName -and $cmd.taskName -notmatch '^[a-zA-Z0-9_-]+$') {
    Write-ElevLog "invalid taskName: $($cmd.taskName)" 'ERROR'
    Write-Result @{ id = $cmd.id; ok = $false; error = 'invalid taskName' }
    Remove-Item $cmdFile.FullName -Force
    exit 1
}

# Esegui comando
try {
    $output = ''
    $exitCode = 0

    switch ($cmd.op) {
        'disable' {
            $output = & schtasks.exe /change /tn $cmd.taskName /disable 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'enable' {
            $output = & schtasks.exe /change /tn $cmd.taskName /enable 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'run' {
            $output = & schtasks.exe /run /tn $cmd.taskName 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'delete' {
            $output = & schtasks.exe /delete /tn $cmd.taskName /f 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'set-comment' {
            # Comment via XML edit (schtasks /change non supporta /comment)
            $xml = & schtasks.exe /query /tn $cmd.taskName /xml 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "export xml failed: $xml" }
            $newComment = [System.Security.SecurityElement]::Escape($cmd.comment)
            if ($xml -match '<Description>.*?</Description>') {
                $xml = $xml -replace '<Description>.*?</Description>', "<Description>$newComment</Description>"
            } else {
                $xml = $xml -replace '(<RegistrationInfo[^>]*>)', "`$1<Description>$newComment</Description>"
            }
            $tmpXml = Join-Path $env:TEMP "rm-cron-$($cmd.id).xml"
            $xml | Set-Content -Path $tmpXml -Encoding Unicode
            $output = & schtasks.exe /create /tn $cmd.taskName /xml $tmpXml /f 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            Remove-Item $tmpXml -Force -ErrorAction SilentlyContinue
        }
        'export-xml' {
            $xml = & schtasks.exe /query /tn $cmd.taskName /xml 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            $output = $xml
        }
        'create-from-xml' {
            if (!(Test-Path $cmd.xmlPath)) { throw "xml path not found: $($cmd.xmlPath)" }
            $output = & schtasks.exe /create /tn $cmd.taskName /xml $cmd.xmlPath /f 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'create' {
            # Modalità semplice: schedule preset (Daily/Weekly/Monthly + day + time)
            $args = @('/create', '/tn', $cmd.taskName, '/tr', $cmd.taskCommand, '/f', '/rl', 'LIMITED')
            switch ($cmd.scheduleType) {
                'DAILY' { $args += @('/sc', 'DAILY', '/st', $cmd.startTime) }
                'WEEKLY' { $args += @('/sc', 'WEEKLY', '/d', $cmd.dayOfWeek, '/st', $cmd.startTime) }
                'MONTHLY' { $args += @('/sc', 'MONTHLY', '/d', $cmd.dayOfMonth, '/st', $cmd.startTime) }
                default { throw "scheduleType invalid: $($cmd.scheduleType)" }
            }
            if ($cmd.comment) {
                # /comment in /create accetta string
                $args += @('/comment', $cmd.comment)
            }
            $output = & schtasks.exe @args 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'rename' {
            # Rename = export + delete + create-from-xml (atomic con rollback)
            $oldName = $cmd.taskName
            $newName = $cmd.newName
            if ($newName -notmatch '^[a-zA-Z0-9_-]+$') { throw "invalid newName: $newName" }
            $xml = & schtasks.exe /query /tn $oldName /xml 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "export xml failed: $xml" }
            $xmlNew = $xml -replace [regex]::Escape("<URI>\$oldName</URI>"), "<URI>\$newName</URI>"
            $tmpXmlNew = Join-Path $env:TEMP "rm-cron-rename-$($cmd.id).xml"
            $xmlNew | Set-Content -Path $tmpXmlNew -Encoding Unicode
            $tmpXmlOld = Join-Path $env:TEMP "rm-cron-rollback-$($cmd.id).xml"
            $xml | Set-Content -Path $tmpXmlOld -Encoding Unicode

            $delOut = & schtasks.exe /delete /tn $oldName /f 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
                throw "delete old failed: $delOut"
            }
            $createOut = & schtasks.exe /create /tn $newName /xml $tmpXmlNew /f 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                # ROLLBACK
                & schtasks.exe /create /tn $oldName /xml $tmpXmlOld /f 2>&1 | Out-Null
                Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
                throw "create new failed (rolled back): $createOut"
            }
            Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
            $output = $createOut
            $exitCode = 0
        }
        'winget-upgrade' {
            # V15.2 WS32: winget upgrade elevated. Plan: eventual-baking-bentley.md.
            # Validazione package id: alphanum + . _ - (winget Id format)
            if (-not $cmd.package -or $cmd.package -notmatch '^[a-zA-Z0-9._-]+$') {
                throw "invalid winget package: $($cmd.package)"
            }
            $wargs = @('upgrade', '--id', $cmd.package, '--exact', '--silent',
                     '--accept-source-agreements', '--accept-package-agreements')
            $output = & winget @wargs 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            # winget exit code -1978335189 (0x8A150011) = "no available upgrade" → success
            if ($exitCode -eq -1978335189) { $exitCode = 0 }
        }
    }

    Write-ElevLog "op=$($cmd.op) task=$($cmd.taskName) exit=$exitCode"
    Write-Result @{ id = $cmd.id; ok = ($exitCode -eq 0); exitCode = $exitCode; output = $output }
} catch {
    Write-ElevLog "exception: $($_.Exception.Message)" 'ERROR'
    Write-Result @{ id = $cmd.id; ok = $false; error = $_.Exception.Message }
} finally {
    Remove-Item $cmdFile.FullName -Force -ErrorAction SilentlyContinue
}
