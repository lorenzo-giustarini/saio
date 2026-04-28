# V14.28 Step 5 — Recipe Builder daily 03:00.
# Wrapper python build_recipes.py + log to vault.

$ErrorActionPreference = 'Continue'

$buildScript = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\scripts\build_recipes.py'
$vaultLogs = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\logs'
$today = Get-Date -Format 'yyyyMMdd'
$logFile = Join-Path $vaultLogs "cron-recipe-builder-$today.log"

if (!(Test-Path $buildScript)) {
    "[$(Get-Date -Format 'o')] ERROR: build_recipes.py non trovato" | Add-Content $logFile
    exit 1
}

"[$(Get-Date -Format 'o')] Start build_recipes.py..." | Add-Content $logFile
& python $buildScript 2>&1 | Add-Content $logFile
"[$(Get-Date -Format 'o')] Done (exit=$LASTEXITCODE)" | Add-Content $logFile
exit $LASTEXITCODE
