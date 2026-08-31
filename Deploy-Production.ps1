# Deploy-Production.ps1
#
# Run this from your EnQuote project root:
#   C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\EnQuote
#
# This is the ONE script to use whenever you want to build + deploy to
# PRODUCTION (enquote.base44.app, app id 6979390a3f44099ffca06859).
#
# It permanently fixes the "wrong app id / wrong data source baked in"
# problem by:
#   1. Backing up your current .env.local (whatever it currently has)
#   2. Overwriting .env.local with the CORRECT, known-good production
#      values (hardcoded below, not relying on manual edits)
#   3. Clearing the Vite build cache (node_modules/.vite) AND the dist
#      folder, so no stale cached transform can leak in
#   4. Building fresh with the correct production values
#   5. Verifying the build actually contains "base44" (not "local") and
#      the PRODUCTION app id (not sandbox) before deploying anything
#   6. Deploying to production with --no-build
#   7. Restoring your .env.local back to whatever it was before (so your
#      local dev environment stays pointed at sandbox for day-to-day work)

$ErrorActionPreference = "Stop"

$envPath   = ".\.env.local"
$prodAppId = "6979390a3f44099ffca06859"
$prodBaseUrl = "https://enquote.base44.app"
$serverUrl = "https://base44.app"

if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found. Run this from the EnQuote project root." -ForegroundColor Red
    exit 1
}

# --- Step 1: Backup current .env.local ---
$backupPath = ".\.env.local.before-prod-deploy.bak"
Copy-Item -Path $envPath -Destination $backupPath -Force
Write-Host "Backed up current .env.local to $backupPath" -ForegroundColor Cyan

# --- Step 2: Write KNOWN-GOOD production values ---
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

# --- Step 3: Clear caches so nothing stale leaks into this build ---
Write-Host ""
Write-Host "Clearing Vite cache and dist folder..." -ForegroundColor Cyan
Remove-Item -Recurse -Force ".\node_modules\.vite" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\dist" -ErrorAction SilentlyContinue

# --- Step 4: Build ---
Write-Host ""
Write-Host "Building for PRODUCTION..." -ForegroundColor Cyan
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    npm run build
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    if (-not (Test-Path "$NodePath\npm.cmd")) {
        Write-Host "ERROR: npm not found on PATH and not found at $NodePath\npm.cmd" -ForegroundColor Red
        Write-Host "Adjust `$NodePath in this script, then re-run." -ForegroundColor Red
        # restore env before exiting
        Copy-Item -Path $backupPath -Destination $envPath -Force
        exit 1
    }
    & "$NodePath\npm.cmd" run build
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Restoring your original .env.local and aborting." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

# --- Step 5: Verify the build is correct BEFORE deploying anything ---
Write-Host ""
Write-Host "Verifying build output..." -ForegroundColor Cyan

$dataSourceOk = $false
$appIdOk = $false

$files = Get-ChildItem .\dist\assets\*.js -ErrorAction SilentlyContinue
foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw
    if ($content -match '\["mock","local","salesforce-mock"\]\.includes\(([^)]*)\)') {
        Write-Host "  Data source check ($($f.Name)): $($Matches[0])"
        if ($Matches[0] -match '"base44"') { $dataSourceOk = $true }
    }
    if ($content -match [regex]::Escape($prodAppId)) {
        Write-Host "  App id check ($($f.Name)): contains PRODUCTION app id ($prodAppId)"
        $appIdOk = $true
    }
}

if (-not $dataSourceOk) {
    Write-Host ""
    Write-Host "ABORTING: Build does NOT show base44 as the data source. Refusing to deploy." -ForegroundColor Red
    Write-Host "Restoring your original .env.local." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

if (-not $appIdOk) {
    Write-Host ""
    Write-Host "ABORTING: Build does NOT contain the PRODUCTION app id. Refusing to deploy." -ForegroundColor Red
    Write-Host "Restoring your original .env.local." -ForegroundColor Red
    Copy-Item -Path $backupPath -Destination $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Build verified clean: base44 data source + production app id confirmed." -ForegroundColor Green

# --- Step 6: Deploy to production ---
Write-Host ""
Write-Host "Deploying to PRODUCTION ($prodAppId) with --no-build..." -ForegroundColor Cyan
base44 deploy --app-id $prodAppId --no-build --yes

# --- Step 7: Restore original .env.local for local dev ---
Write-Host ""
Write-Host "Restoring your original .env.local (for local dev against sandbox)..." -ForegroundColor Cyan
Copy-Item -Path $backupPath -Destination $envPath -Force
Get-Content $envPath | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "Done. Open https://enquote.base44.app in a fresh incognito window," -ForegroundColor Green
Write-Host "with DevTools Network tab open and 'Disable cache' checked, then hard reload." -ForegroundColor Green
