# V15.0 — Stop SAIO dashboard background processes (frontend Vite + backend Express)
$ports = 3030, 3031
foreach ($port in $ports) {
  $line = netstat -ano | Select-String ":$port .*LISTENING" | Select-Object -First 1
  if ($line) {
    $pid = ($line -split '\s+')[-1]
    Write-Host "Killing PID $pid on port $port..." -ForegroundColor Yellow
    taskkill /F /PID $pid 2>&1 | Out-Null
  } else {
    Write-Host "Port $port already free" -ForegroundColor Gray
  }
}
Write-Host "SAIO stopped." -ForegroundColor Green
