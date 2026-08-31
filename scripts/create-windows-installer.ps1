$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue

if (-not $nodeCmd -or -not $npmCmd) {
    Write-Error "Node.js and npm are not installed or not on PATH. Install Node.js LTS, then rerun this script."
    exit 1
}

Write-Host "Building EnQuote Windows installer..."
$env:VITE_DATA_SOURCE = "local"
& npm run desktop:package:win

if ($LASTEXITCODE -ne 0) {
    Write-Error "Windows installer build failed."
    exit $LASTEXITCODE
}

Write-Host "Installer build complete. Check the release folder."
