$ErrorActionPreference = 'Stop'
$frontendPath = Join-Path $PSScriptRoot 'frontend'

Set-Location $frontendPath
npm run dev
exit $LASTEXITCODE
