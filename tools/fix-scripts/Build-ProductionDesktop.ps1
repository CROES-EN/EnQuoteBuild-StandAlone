# Build-ProductionDesktop.ps1
#
# Run this from your NEW Desktop project folder (NOT the OneDrive one):
#   C:\Users\croeschberger\Desktop\EnQuote
#
# This builds a Windows installer (.exe) of EnQuote connected to REAL
# PRODUCTION Base44 data (app id 6979390a3f44099ffca06859), for beta
# testing with your team. This is DIFFERENT from the demo build --
# this version will read/write real production Quotes and Products.
#
# Safety measures (same pattern as the web Deploy-Production.ps1 script):
#   1. Backs up whatever .env.local currently has
#   2. Overwrites it with hardcoded, correct PRODUCTION values
#   3. Clears Vite cache + dist + release folders so nothing stale leaks in
#   4. Builds the site, then verifies "base44" + the production app id
#      are actually baked into the output BEFORE packaging the installer
#   5. Runs electron-builder to produce the Windows installer
#   6. Restores your original .env.local afterward
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\Build-ProductionDesktop.ps1

$ErrorActionPreference = "Stop"

$prodAppId   = "6979390a3f44099ffca06859"
$prodBaseUrl = "https://enquote.base44.app"
$serverUrl   = "https://base44.app"

$envPath = ".\.env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found. Run this from the Desktop\EnQuote project root." -ForegroundColor Red
    exit 1
}

# --- Check for the rogue shell-level env var that bit us earlier today ---
$shellOverride = [Environment]::GetEnvironmentVariable("VITE_DATA_SOURCE", "Process")
if ($shellOverride) {
    Write-Host "WARNING: A shell-level VITE_DATA_SOURCE='$shellOverride' is set in this terminal session." -ForegroundColor Yellow
    Write-Host "Clearing it for this session before proceeding." -ForegroundColor Yellow
    Remove-Item Env:VITE_DATA_SOURCE -ErrorAction SilentlyContinue
}

# --- Step 1: Backup current .env.local ---
$backupPath = ".\.env.local.before-prod-desktop-build.bak"
Copy-Item -Path $envPath -Destination $backupPath -Force
Write-Host "Backed up current .env.local to $backupPath" -ForegroundColor Cyan

# --- Step 2: Write known-good PRODUCTION values ---
$prodEnvContent = @"
VITE_DATA_SOURCE=base44
VITE_BASE44_FUNCTIONS_VERSION=prod
VITE_BASE44_APP_BASE_URL=$prodBaseUrl
VITE_BASE44_SERVER_URL=$serverUrl
VITE_BASE44_APP_ID=$prodAppId
"@
Set-Content -Path $envPath -Value $prodEnvContent -Encoding UTF8
Write-Host "Wrote production values to .env.local:" -ForegroundColor Green
Get-Content $envPath | ForEach-Object { Write-Host "  $_" }

# --- Step 3: Clear caches / old output ---
Write-Host ""
Write-Host "Clearing Vite cache, dist, and release folders..." -ForegroundColor Cyan
Remove-Item -Recurse -Force ".\node_modules\.vite" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\dist" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\release" -ErrorAction SilentlyContinue

# --- Step 4: Build the site (plain build, no VITE_DATA_SOURCE override) ---
Write-Host ""
Write-Host "Building site for PRODUCTION..." -ForegroundColor Cyan
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    npm run build
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    if (-not (Test-Path "$NodePath\npm.cmd")) {
        Write-Host "ERROR: npm not found on PATH and not found at $NodePath\npm.cmd" -ForegroundColor Red
        Copy-Item -Path $backupPath -Destination $envPath -Force
        exit 1
    }
    & "$NodePath\npm.cmd" run build
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Restoring .env.local and aborting." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

# --- Step 5: Verify BEFORE packaging ---
Write-Host ""
Write-Host "Verifying build output..." -ForegroundColor Cyan
$dataSourceOk = $false
$appIdOk = $false
$builtFiles = Get-ChildItem .\dist\assets\*.js -ErrorAction SilentlyContinue
foreach ($f in $builtFiles) {
    $c = Get-Content $f.FullName -Raw
    if ($c -match '\["mock","local","salesforce-mock"\]\.includes\(([^)]*)\)') {
        Write-Host "  Data source check ($($f.Name)): $($Matches[0])"
        if ($Matches[0] -match '"base44"') { $dataSourceOk = $true }
    }
    if ($c -match [regex]::Escape($prodAppId)) { $appIdOk = $true }
}

if (-not $dataSourceOk -or -not $appIdOk) {
    Write-Host ""
    Write-Host "ABORTING: Build verification failed (data source or app id not correctly baked in)." -ForegroundColor Red
    Write-Host "Refusing to package an installer with unverified/incorrect data source." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Build verified clean: base44 data source + production app id confirmed." -ForegroundColor Green

# --- Step 6: Package the Windows installer ---
Write-Host ""
Write-Host "Packaging Windows installer (electron-builder)..." -ForegroundColor Cyan
$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if ($npxCmd) {
    npx electron-builder --win --publish never
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    & "$NodePath\npx.cmd" electron-builder --win --publish never
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "electron-builder failed. Restoring .env.local." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

# --- Step 7: Restore original .env.local ---
Write-Host ""
Write-Host "Restoring your original .env.local..." -ForegroundColor Cyan
Copy-Item -Path $backupPath -Destination $envPath -Force

Write-Host ""
Write-Host "Done. Your PRODUCTION-connected installer is at:" -ForegroundColor Green
Get-ChildItem .\release\*.exe | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Green }
Write-Host ""
Write-Host "IMPORTANT: This installer connects to REAL production data." -ForegroundColor Yellow
Write-Host "Test it yourself first before sharing with your beta team." -ForegroundColor Yellow
