# Fix-ProductsQuotesUnwrap.ps1
#
# Run this from your EnQuote project root:
#   C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\EnQuote
#
# What this does:
#   1. Backs up src\api\adapters\base44Adapter.js
#   2. Patches getProducts() and getQuotes() to safely unwrap
#      { products: [...] } / { quotes: [...] } response shapes
#      (in addition to still handling plain arrays)
#   3. Rebuilds the site (npm run build)
#   4. Deploys the fixed site to PRODUCTION (--no-build, so the
#      broken CLI build step is bypassed)
#
# Safe to re-run: if the patched code is already present, it will
# skip re-patching and just rebuild + redeploy.

$ErrorActionPreference = "Stop"

$adapterPath = ".\src\api\adapters\base44Adapter.js"
$prodAppId   = "6979390a3f44099ffca06859"

if (-not (Test-Path $adapterPath)) {
    Write-Host "ERROR: Could not find $adapterPath" -ForegroundColor Red
    Write-Host "Make sure you're running this script from the EnQuote project root." -ForegroundColor Yellow
    exit 1
}

# --- Step 1: Backup ---
$backupPath = ".\src\api\adapters\base44Adapter.js.bak"
Copy-Item -Path $adapterPath -Destination $backupPath -Force
Write-Host "Backed up existing file to $backupPath" -ForegroundColor Cyan

$content = Get-Content -Path $adapterPath -Raw

# --- Step 2: Patch getQuotes and getProducts ---
# Using plain string .Replace() (not regex) to avoid escaping issues with
# special characters like ? and () in the source code.

$oldGetQuotes = "getQuotes: async () => {`r`n      const response = await base44.functions.invoke(`"getAllQuotes`");`r`n      return response?.data || [];`r`n    },"
$newGetQuotes = "getQuotes: async () => {`r`n      const response = await base44.functions.invoke(`"getAllQuotes`");`r`n      const data = response?.data;`r`n      if (Array.isArray(data)) return data;`r`n      if (Array.isArray(data?.quotes)) return data.quotes;`r`n      return [];`r`n    },"

$oldGetProducts = "getProducts: async () => {`r`n      const response = await base44.functions.invoke(`"getAllProducts`");`r`n      return response?.data || [];`r`n    },"
$newGetProducts = "getProducts: async () => {`r`n      const response = await base44.functions.invoke(`"getAllProducts`");`r`n      const data = response?.data;`r`n      if (Array.isArray(data)) return data;`r`n      if (Array.isArray(data?.products)) return data.products;`r`n      return [];`r`n    },"

$patchedAny = $false

if ($content.Contains($oldGetQuotes)) {
    $content = $content.Replace($oldGetQuotes, $newGetQuotes)
    Write-Host "Patched getQuotes()" -ForegroundColor Green
    $patchedAny = $true
} elseif ($content -match "Array\.isArray\(data\?\.quotes\)") {
    Write-Host "getQuotes() already patched, skipping." -ForegroundColor Yellow
} else {
    Write-Host "WARNING: Could not find exact getQuotes() block to patch (whitespace may differ)." -ForegroundColor Yellow
    Write-Host "You may need to patch it manually. See instructions below." -ForegroundColor Yellow
}

if ($content.Contains($oldGetProducts)) {
    $content = $content.Replace($oldGetProducts, $newGetProducts)
    Write-Host "Patched getProducts()" -ForegroundColor Green
    $patchedAny = $true
} elseif ($content -match "Array\.isArray\(data\?\.products\)") {
    Write-Host "getProducts() already patched, skipping." -ForegroundColor Yellow
} else {
    Write-Host "WARNING: Could not find exact getProducts() block to patch (whitespace may differ)." -ForegroundColor Yellow
    Write-Host "You may need to patch it manually. See instructions below." -ForegroundColor Yellow
}

Set-Content -Path $adapterPath -Value $content -Encoding UTF8 -NoNewline

# --- Step 3: Verify ---
Write-Host ""
Write-Host "Verifying patched content:" -ForegroundColor Cyan
Select-String -Path $adapterPath -Pattern "Array.isArray\(data" | ForEach-Object { $_.Line.Trim() }

if (-not $patchedAny) {
    Write-Host ""
    Write-Host "Neither block was patched automatically. Open the file manually:" -ForegroundColor Red
    Write-Host "  notepad $adapterPath" -ForegroundColor Red
    Write-Host "and find getQuotes / getProducts to apply the fix by hand, then re-run this script (it will skip the patch step and just build+deploy)." -ForegroundColor Red
}

# --- Step 4: Build ---
# Use plain npm if available on PATH; otherwise fall back to the known
# Node install location used earlier in this project.
Write-Host ""
Write-Host "Building site..." -ForegroundColor Cyan

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if ($npmCmd) {
    npm run build
} else {
    $NodePath = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
    if (-not (Test-Path "$NodePath\npm.cmd")) {
        Write-Host "ERROR: npm not found on PATH and not found at $NodePath\npm.cmd" -ForegroundColor Red
        Write-Host "Adjust `$NodePath in this script to point at your Node install." -ForegroundColor Red
        exit 1
    }
    & "$NodePath\npm.cmd" run build
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Aborting before deploy." -ForegroundColor Red
    exit 1
}

# --- Step 5: Deploy to production, bypassing the CLI's own (buggy) build step ---
Write-Host ""
Write-Host "Deploying to PRODUCTION ($prodAppId) with --no-build..." -ForegroundColor Cyan
base44 deploy --app-id $prodAppId --no-build --yes

Write-Host ""
Write-Host "Done. Reload https://enquote.base44.app (hard refresh / incognito) and check Create Quote." -ForegroundColor Green
