# Rollback-ToPreCritterGuard.ps1
#
# Run this from C:\EnQuoteBuild:
#   powershell -ExecutionPolicy Bypass -File .\Rollback-ToPreCritterGuard.ps1
#
# What this does:
#   1. Restores draftEngine.js from draftEngine.js.bak (undoes today's
#      critter-guard pricing fix)
#   2. Restores base44Adapter.js from base44Adapter.js.bak (undoes today's
#      products/quotes unwrap fix)
#   3. Backs up the CURRENT (post-critterguard) versions first, just in
#      case you need to re-apply those fixes later -- nothing is deleted,
#      only replaced.
#   4. Rebuilds + verifies + deploys to PRODUCTION using the same safe
#      pattern as every other script today (hardcoded prod env values,
#      cache clear, verify base44+prod-app-id baked in before allowing
#      deploy).
#
# After this completes, test in a PLAIN BROWSER INCOGNITO WINDOW at
# https://enquote.base44.app -- NOT the Electron desktop app -- to see
# the actual current state of production, isolated from any Electron
# session-caching issues.

$ErrorActionPreference = "Stop"

$prodAppId   = "6979390a3f44099ffca06859"
$prodBaseUrl = "https://enquote.base44.app"
$serverUrl   = "https://base44.app"

$draftEnginePath   = ".\src\features\quoteDraftAgent\draftEngine.js"
$draftEngineBak     = "$draftEnginePath.bak"
$adapterPath        = ".\src\api\adapters\base44Adapter.js"
$adapterBak         = "$adapterPath.bak"

foreach ($f in @($draftEngineBak, $adapterBak)) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: Could not find $f" -ForegroundColor Red
        Write-Host "Make sure you're running this from C:\EnQuoteBuild" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "=== Rolling back to pre-critter-guard-fix state ===" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Preserve current (post-fix) versions before overwriting ---
$preserveSuffix = ".before-rollback-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Path $draftEnginePath -Destination "$draftEnginePath$preserveSuffix" -Force
Copy-Item -Path $adapterPath -Destination "$adapterPath$preserveSuffix" -Force
Write-Host "Preserved current versions as:" -ForegroundColor Cyan
Write-Host "  $draftEnginePath$preserveSuffix"
Write-Host "  $adapterPath$preserveSuffix"

# --- Step 2: Restore from .bak ---
Copy-Item -Path $draftEngineBak -Destination $draftEnginePath -Force
Copy-Item -Path $adapterBak -Destination $adapterPath -Force
Write-Host ""
Write-Host "Restored from backup:" -ForegroundColor Green
Write-Host "  $draftEnginePath  <-  $draftEngineBak"
Write-Host "  $adapterPath  <-  $adapterBak"

# --- Step 3: Check for the rogue shell-level env var ---
$shellOverride = [Environment]::GetEnvironmentVariable("VITE_DATA_SOURCE", "Process")
if ($shellOverride) {
    Write-Host ""
    Write-Host "WARNING: Shell-level VITE_DATA_SOURCE='$shellOverride' detected. Clearing it." -ForegroundColor Yellow
    Remove-Item Env:VITE_DATA_SOURCE -ErrorAction SilentlyContinue
}

# --- Step 4: Build + deploy using the same safe, verified pattern ---
$envPath = ".\.env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found." -ForegroundColor Red
    exit 1
}

$envBackupPath = ".\.env.local.before-rollback.bak"
Copy-Item -Path $envPath -Destination $envBackupPath -Force

$envContent = @"
VITE_DATA_SOURCE=base44
VITE_BASE44_FUNCTIONS_VERSION=prod
VITE_BASE44_APP_BASE_URL=$prodBaseUrl
VITE_BASE44_SERVER_URL=$serverUrl
VITE_BASE44_APP_ID=$prodAppId
"@
Set-Content -Path $envPath -Value $envContent -Encoding UTF8

Write-Host ""
Write-Host "=== Building for PRODUCTION ($prodAppId) ===" -ForegroundColor Cyan
Remove-Item -Recurse -Force ".\node_modules\.vite" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\dist" -ErrorAction SilentlyContinue

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    npm run build
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    if (-not (Test-Path "$NodePath\npm.cmd")) {
        Write-Host "ERROR: npm not found on PATH and not found at $NodePath\npm.cmd" -ForegroundColor Red
        Copy-Item -Path $envBackupPath -Destination $envPath -Force
        exit 1
    }
    & "$NodePath\npm.cmd" run build
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Restoring .env.local and aborting." -ForegroundColor Red
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 1
}

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
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Build verified clean: base44 data source + production app id confirmed." -ForegroundColor Green

Write-Host ""
Write-Host "=== Deploying to production ($prodAppId) with --no-build ===" -ForegroundColor Cyan
base44 deploy --app-id $prodAppId --no-build --yes

Write-Host ""
Write-Host "Restoring your original .env.local..." -ForegroundColor Cyan
Copy-Item -Path $envBackupPath -Destination $envPath -Force

Write-Host ""
Write-Host "=== Rollback deployed. ===" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Now test in a PLAIN BROWSER, INCOGNITO WINDOW (NOT the Electron desktop app):" -ForegroundColor Yellow
Write-Host "  https://enquote.base44.app/CreateQuote" -ForegroundColor Yellow
Write-Host ""
Write-Host "This isolates the test from any Electron session-caching issues we ran into earlier." -ForegroundColor Yellow
Write-Host "Check whether the button says 'Quote Draft Agent' or 'AI Assistant' and report back." -ForegroundColor Yellow
