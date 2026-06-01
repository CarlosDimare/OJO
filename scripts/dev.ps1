$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "5000" }
$VitePort = if ($env:VITE_PORT) { $env:VITE_PORT } else { "5173" }

# Ensure dependencies and dist exist
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  pnpm install
}
if (-not (Test-Path "artifacts/api-server/dist/index.mjs")) {
  Write-Host "Building workspace..." -ForegroundColor Yellow
  pnpm run build
}

# Start backend
Write-Host "Starting backend on port ${BackendPort}..." -ForegroundColor Green
$env:PORT = $BackendPort
$backendJob = Start-Job -ScriptBlock {
  param($port)
  $env:PORT = $port
  node --enable-source-maps ./artifacts/api-server/dist/index.mjs
} -ArgumentList $BackendPort

# Wait for backend to be ready
$ready = $false
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $null = Invoke-WebRequest -Uri "http://localhost:${BackendPort}/api/redaccion" -UseBasicParsing -TimeoutSec 2
    Write-Host "Backend ready on port ${BackendPort}" -ForegroundColor Green
    $ready = $true
    break
  } catch {
    if ($i -eq 15) {
      Write-Host "WARNING: Backend not ready after 15s, starting Vite anyway" -ForegroundColor Yellow
    }
  }
}

# Start Vite dev server
Write-Host "Starting Vite on port ${VitePort}..." -ForegroundColor Green
$env:PORT = $VitePort
$env:BASE_PATH = "/"
$viteJob = Start-Job -ScriptBlock {
  param($port)
  $env:PORT = $port
  $env:BASE_PATH = "/"
  pnpm --filter @workspace/web-terminal run dev
} -ArgumentList $VitePort

Write-Host ""
Write-Host "==================================="
Write-Host " Backend:  http://localhost:${BackendPort}"
Write-Host " Vite:     http://localhost:${VitePort}"
Write-Host "==================================="
Write-Host ""

# Wait for user to press Ctrl+C
try {
  while ($true) {
    Start-Sleep -Seconds 1
    # Check if jobs are still running
    $backendRunning = (Get-Job -Id $backendJob.Id -ErrorAction SilentlyContinue) -and ($backendJob.State -eq "Running")
    $viteRunning = (Get-Job -Id $viteJob.Id -ErrorAction SilentlyContinue) -and ($viteJob.State -eq "Running")
    if (-not $backendRunning -or -not $viteRunning) {
      Write-Host "A process exited. Stopping..." -ForegroundColor Red
      break
    }
  }
} finally {
  Stop-Job $backendJob -ErrorAction SilentlyContinue
  Stop-Job $viteJob -ErrorAction SilentlyContinue
  Remove-Job $backendJob -ErrorAction SilentlyContinue
  Remove-Job $viteJob -ErrorAction SilentlyContinue
}
