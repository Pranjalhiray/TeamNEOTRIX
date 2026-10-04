$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$frontendPath = Join-Path $projectRoot 'frontend'
$distIndex = Join-Path $frontendPath 'dist\index.html'
$artifactPath = Join-Path $projectRoot 'artifacts\bundle.joblib'
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

Set-Location $projectRoot

if (Test-Path $venvPython) {
    $pythonCommand = $venvPython
} else {
    $pythonOnPath = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonOnPath) {
        throw 'Python 3 is not available. Install Python 3.10 or newer, or create the project .venv first.'
    }
    $pythonCommand = $pythonOnPath.Source
}

if (-not (Test-Path $artifactPath)) {
    throw 'The trained model bundle is missing. Build it once with: python src\build_artifacts.py'
}

& $pythonCommand -c 'import xgboost, lightgbm' *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'The bundled model needs XGBoost and LightGBM. Install them once with: .\.venv\Scripts\python.exe -m pip install "xgboost>=3.0,<4" "lightgbm>=4.0,<5"'
}

if (-not (Test-Path $distIndex)) {
    if (-not (Test-Path (Join-Path $frontendPath 'node_modules'))) {
        throw 'Frontend dependencies are not installed. From frontend, run npm ci once, then launch this script again.'
    }
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        throw 'Node.js and npm are needed for the first frontend build. After frontend\dist is built, the app runs with Python alone.'
    }

    Push-Location $frontendPath
    try {
        & $npmCommand.Source run build
        if ($LASTEXITCODE -ne 0) {
            throw "Frontend build failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}

$port = 8000
while ($port -le 8010) {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    try {
        $probe.Start()
        $probe.Stop()
        break
    } catch {
        $port += 1
    }
}
if ($port -gt 8010) {
    throw 'Ports 8000 through 8010 are already in use. Close another local service and try again.'
}

Write-Host ''
Write-Host 'Bitcoin Transaction Forensics is running locally.' -ForegroundColor Cyan
Write-Host "Open http://127.0.0.1:$port in your browser." -ForegroundColor Cyan
Write-Host 'This runtime uses the local model bundle and does not require internet access.' -ForegroundColor DarkGray
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

& $pythonCommand -m uvicorn api.main:app --host 127.0.0.1 --port $port
