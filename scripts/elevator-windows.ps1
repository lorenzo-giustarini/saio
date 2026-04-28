# elevator-windows.ps1 - SAIO Tauri elevated runner per Windows (V15.9 WS39)
#
# Eseguito dal task scheduler `RM-Saio-Tauri-Elevator` (RunLevel=Highest, owner user)
# che permette zero-UAC trigger via `schtasks /run`. IPC via JSON files in
# data/elevator/cmd-*.json -> result-*.json.
#
# Whitelist op:
#   task-enable, task-disable, task-run, task-create, task-delete, task-rename,
#   task-export-xml, task-create-from-xml, task-set-comment,
#   pkg-upgrade, pkg-install, shell

$ErrorActionPreference = 'Stop'

$DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\elevator'
$LogFile = Join-Path $DataDir 'elevator.log'

if (!(Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

function Write-ElevLog($msg, $level = 'INFO') {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
    "$ts [$level] $msg" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

# Cerca cmd file più recente (max 30s)
$cmdFile = Get-ChildItem -Path $DataDir -Filter 'cmd-*.json' -ErrorAction SilentlyContinue |
    Where-Object { (New-TimeSpan -Start $_.LastWriteTime -End (Get-Date)).TotalSeconds -lt 30 } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (!$cmdFile) {
    Write-ElevLog 'no cmd file found within 30s window' 'WARN'
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

function Write-Result($obj) {
    $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $resultFile -Encoding UTF8
}

# V15.9 WS39 hotfix — backward-compat alias map: il backend `server/lib/elevator.ts`
# usa nomi op brevi (`disable`, `enable`, `run`, `winget-upgrade`, ...) ereditati
# dal SAIO originale. Il PS1 ha contratto PAL canonico con prefisso `task-`. Mappiamo.
$opAliases = @{
    'disable'         = 'task-disable'
    'enable'          = 'task-enable'
    'run'             = 'task-run'
    'create'          = 'task-create'
    'delete'          = 'task-delete'
    'rename'          = 'task-rename'
    'export-xml'      = 'task-export-xml'
    'create-from-xml' = 'task-create-from-xml'
    'set-comment'     = 'task-set-comment'
    'winget-upgrade'  = 'pkg-upgrade'
}
if ($opAliases.ContainsKey($cmd.op)) {
    $aliasedOp = $opAliases[$cmd.op]
    Write-ElevLog "op alias: $($cmd.op) -> $aliasedOp"
    $cmd | Add-Member -NotePropertyName op -NotePropertyValue $aliasedOp -Force
}

# Whitelist
$allowedOps = @(
    'task-enable', 'task-disable', 'task-run', 'task-create', 'task-delete',
    'task-rename', 'task-export-xml', 'task-create-from-xml', 'task-set-comment',
    'pkg-upgrade', 'pkg-install', 'shell'
)
if ($cmd.op -notin $allowedOps) {
    Write-ElevLog "op not allowed: $($cmd.op)" 'ERROR'
    Write-Result @{ ok = $false; error = "op not allowed: $($cmd.op)" }
    Remove-Item $cmdFile.FullName -Force
    exit 1
}

# Validation taskName se presente
if ($cmd.taskName -and $cmd.taskName -notmatch '^[a-zA-Z0-9_-]+$') {
    Write-ElevLog "invalid taskName: $($cmd.taskName)" 'ERROR'
    Write-Result @{ ok = $false; error = 'invalid taskName' }
    Remove-Item $cmdFile.FullName -Force
    exit 1
}

try {
    $output = ''
    $exitCode = 0

    switch ($cmd.op) {
        'task-disable' {
            $output = & schtasks.exe /change /tn $cmd.taskName /disable 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'task-enable' {
            $output = & schtasks.exe /change /tn $cmd.taskName /enable 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'task-run' {
            $output = & schtasks.exe /run /tn $cmd.taskName 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'task-delete' {
            $output = & schtasks.exe /delete /tn $cmd.taskName /f 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'task-set-comment' {
            $xml = & schtasks.exe /query /tn $cmd.taskName /xml 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "export xml failed: $xml" }
            $newComment = [System.Security.SecurityElement]::Escape($cmd.comment)
            if ($xml -match '<Description>.*?</Description>') {
                $xml = $xml -replace '<Description>.*?</Description>', "<Description>$newComment</Description>"
            } else {
                $xml = $xml -replace '(<RegistrationInfo[^>]*>)', "`$1<Description>$newComment</Description>"
            }
            $tmpXml = Join-Path $env:TEMP "saio-tauri-cron-$($cmd.id).xml"
            $xml | Set-Content -Path $tmpXml -Encoding Unicode
            $output = & schtasks.exe /create /tn $cmd.taskName /xml $tmpXml /f 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            Remove-Item $tmpXml -Force -ErrorAction SilentlyContinue
        }
        'task-create' {
            $time = if ($cmd.spec.time -and $cmd.spec.time -match '^\d{2}:\d{2}$') { $cmd.spec.time } else { '03:00' }
            $args = @('/create', '/tn', $cmd.taskName, '/tr', $cmd.command, '/f', '/rl', 'LIMITED')
            switch ($cmd.spec.type) {
                'DAILY' { $args += @('/sc', 'DAILY', '/st', $time) }
                'WEEKLY' {
                    $day = if ($cmd.spec.day) { $cmd.spec.day } else { 'MON' }
                    $args += @('/sc', 'WEEKLY', '/d', $day, '/st', $time)
                }
                'MONTHLY' {
                    $dom = if ($cmd.spec.dayOfMonth) { $cmd.spec.dayOfMonth } else { '1' }
                    $args += @('/sc', 'MONTHLY', '/d', $dom, '/st', $time)
                }
                'ONCE' { $args += @('/sc', 'ONCE', '/st', $time) }
                default { throw "scheduleType invalid: $($cmd.spec.type)" }
            }
            if ($cmd.description) { $args += @('/comment', $cmd.description) }
            $output = & schtasks.exe @args 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'task-rename' {
            $oldName = $cmd.taskName
            $newName = $cmd.newName
            if ($newName -notmatch '^[a-zA-Z0-9_-]+$') { throw "invalid newName: $newName" }
            $xml = & schtasks.exe /query /tn $oldName /xml 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { throw "export xml failed: $xml" }
            $xmlNew = $xml -replace [regex]::Escape("<URI>\$oldName</URI>"), "<URI>\$newName</URI>"
            $tmpXmlNew = Join-Path $env:TEMP "saio-tauri-rename-$($cmd.id).xml"
            $xmlNew | Set-Content -Path $tmpXmlNew -Encoding Unicode
            $tmpXmlOld = Join-Path $env:TEMP "saio-tauri-rollback-$($cmd.id).xml"
            $xml | Set-Content -Path $tmpXmlOld -Encoding Unicode
            $delOut = & schtasks.exe /delete /tn $oldName /f 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
                throw "delete old failed: $delOut"
            }
            $createOut = & schtasks.exe /create /tn $newName /xml $tmpXmlNew /f 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                & schtasks.exe /create /tn $oldName /xml $tmpXmlOld /f 2>&1 | Out-Null
                Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
                throw "create new failed (rolled back): $createOut"
            }
            Remove-Item $tmpXmlNew, $tmpXmlOld -Force -ErrorAction SilentlyContinue
            $output = $createOut
            $exitCode = 0
        }
        'pkg-upgrade' {
            if (-not $cmd.package -or $cmd.package -notmatch '^[a-zA-Z0-9._-]+$') {
                throw "invalid winget package: $($cmd.package)"
            }
            $wargs = @('upgrade', '--id', $cmd.package, '--exact', '--silent',
                       '--accept-source-agreements', '--accept-package-agreements')
            $output = & winget @wargs 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
            if ($exitCode -eq -1978335189) { $exitCode = 0 }
        }
        'pkg-install' {
            if (-not $cmd.package -or $cmd.package -notmatch '^[a-zA-Z0-9._-]+$') {
                throw "invalid winget package: $($cmd.package)"
            }
            $wargs = @('install', '--id', $cmd.package, '--exact', '--silent',
                       '--accept-source-agreements', '--accept-package-agreements')
            $output = & winget @wargs 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
        'shell' {
            $shellArgs = if ($cmd.args) { $cmd.args } else { @() }
            $output = & cmd.exe /c $cmd.command @shellArgs 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        }
    }

    Write-ElevLog "op=$($cmd.op) task=$($cmd.taskName) pkg=$($cmd.package) exit=$exitCode"
    Write-Result @{ ok = ($exitCode -eq 0); exitCode = $exitCode; output = $output }
} catch {
    Write-ElevLog "exception: $($_.Exception.Message)" 'ERROR'
    Write-Result @{ ok = $false; error = $_.Exception.Message }
} finally {
    Remove-Item $cmdFile.FullName -Force -ErrorAction SilentlyContinue
}
