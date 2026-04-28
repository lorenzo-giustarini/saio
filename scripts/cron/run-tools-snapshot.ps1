# V14.28 Step 5 — Tools snapshot weekly. Inventario pip + npm + git remote.

$ErrorActionPreference = 'Continue'

$vaultInventory = Join-Path $env:USERPROFILE '.claude\projects\C--Users-info-Desktop-CLAUDE-WORLD\memory\inventory'
if (!(Test-Path $vaultInventory)) { New-Item -ItemType Directory -Path $vaultInventory -Force | Out-Null }

$year = Get-Date -Format 'yyyy'
$week = (Get-Date -UFormat %V)
$file = Join-Path $vaultInventory "tools-$year-W$week.md"

$lines = @()
$lines += "# Tools Snapshot — $year W$week"
$lines += ""
$lines += "> Generated: $(Get-Date -Format 'o')"
$lines += ""

# pip global
$lines += "## pip (global)"
try {
    $pip = pip list 2>$null | Out-String
    $lines += '```'
    $lines += $pip.Trim()
    $lines += '```'
} catch {
    $lines += '_pip non disponibile_'
}
$lines += ""

# npm global
$lines += "## npm global"
try {
    $npm = npm list -g --depth=0 2>$null | Out-String
    $lines += '```'
    $lines += $npm.Trim()
    $lines += '```'
} catch {
    $lines += '_npm non disponibile_'
}
$lines += ""

# Git remote inventory
$lines += "## Git repo locali"
$searchRoots = @(
    "$env:USERPROFILE\Desktop\CLAUDE WORLD",
    "$env:USERPROFILE\Desktop\GSD-AGENCY",
    "$env:USERPROFILE\Desktop\Obsidian-Knowledge-Base"
)
foreach ($root in $searchRoots) {
    if (!(Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Directory -Recurse -Force -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName '.git') } |
        Select-Object -First 30 |
        ForEach-Object {
            try {
                Set-Location $_.FullName
                $remote = git remote get-url origin 2>$null
                $branch = git symbolic-ref --short HEAD 2>$null
                if ($remote) {
                    $rel = $_.FullName.Replace($env:USERPROFILE, '~').Replace('\', '/')
                    $lines += "- ``$rel`` · $branch · $remote"
                }
            } catch { /* skip */ }
        }
}

$lines | Set-Content -Path $file -Encoding UTF8
Write-Output "Snapshot scritto in $file"
exit 0
