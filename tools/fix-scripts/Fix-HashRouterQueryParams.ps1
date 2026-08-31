# Fix-HashRouterQueryParams.ps1
#
# Run this from your EnQuote project root:
#   C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\EnQuote
#
# THE BUG:
#   The app uses <HashRouter> (confirmed in src/App.jsx), so real URLs look
#   like:  https://enquote.base44.app/#/QuoteDetails?id=abc123
#   The "?id=abc123" part lives INSIDE the hash fragment, not in the
#   actual URL path. window.location.search only reads the query string
#   of the real path -- it is ALWAYS EMPTY here. So every page below reads
#   quoteId/id params as null, and things like Quote Details silently show
#   "Quote not found" even though the quote exists (getQuoteById never
#   even fires, since `enabled: !!quoteId` is false).
#
# THE FIX:
#   Replace `new URLSearchParams(window.location.search)` with
#   `new URLSearchParams(location.search)`, where `location` comes from
#   React Router's `useLocation()` hook (which correctly parses the query
#   string living inside the hash route).
#
# Affected files (found via grep across the project):
#   - src/pages/Boneyard.jsx
#   - src/pages/EditQuote.jsx
#   - src/pages/InactiveCollections.jsx
#   - src/pages/QuoteDetails.jsx
#   - src/pages/QuoteOverview.jsx
#   - src/pages/Quotes.jsx
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\Fix-HashRouterQueryParams.ps1
#   powershell -ExecutionPolicy Bypass -File .\Fix-HashRouterQueryParams.ps1 -Target sandbox
#   powershell -ExecutionPolicy Bypass -File .\Fix-HashRouterQueryParams.ps1 -PatchOnly
#
# -Target defaults to "production". Use "sandbox" to deploy the same fix
#  to the sandbox app instead. -PatchOnly patches the files and builds,
#  but does NOT deploy (useful to review the diff / test locally first).

param(
    [ValidateSet("production", "sandbox")]
    [string]$Target = "production",
    [switch]$PatchOnly
)

$ErrorActionPreference = "Stop"

$targets = @{
    production = @{ AppId = "6979390a3f44099ffca06859"; BaseUrl = "https://enquote.base44.app" }
    sandbox    = @{ AppId = "6a91e7bce36dd777fa88cf04"; BaseUrl = "https://en-quote-stand-alone-fa88cf04.base44.app" }
}
$appId   = $targets[$Target].AppId
$baseUrl = $targets[$Target].BaseUrl

$files = @(
    ".\src\pages\Boneyard.jsx",
    ".\src\pages\EditQuote.jsx",
    ".\src\pages\InactiveCollections.jsx",
    ".\src\pages\QuoteDetails.jsx",
    ".\src\pages\QuoteOverview.jsx",
    ".\src\pages\Quotes.jsx"
)

Write-Host "=== Patching $($files.Count) files to fix HashRouter query param bug ===" -ForegroundColor Cyan
Write-Host ""

$anyFailed = $false

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Host "SKIP (not found): $file" -ForegroundColor Yellow
        continue
    }

    $backupPath = "$file.bak"
    Copy-Item -Path $file -Destination $backupPath -Force

    $content = Get-Content -Path $file -Raw
    $originalContent = $content
    $changed = $false

    # --- 1. Ensure useLocation is imported from react-router-dom ---
    if ($content -notmatch 'useLocation') {
        # Try to extend an existing "import { ... } from "react-router-dom";" line
        $importRegex = [regex]'import\s*\{([^}]*)\}\s*from\s*"react-router-dom";'
        $importMatch = $importRegex.Match($content)
        if ($importMatch.Success) {
            $existingNames = $importMatch.Groups[1].Value
            $newImportLine = "import {" + $existingNames.TrimEnd() + ", useLocation} from ""react-router-dom"";"
            $content = $content.Remove($importMatch.Index, $importMatch.Length).Insert($importMatch.Index, $newImportLine)
            $changed = $true
        } else {
            # No react-router-dom import at all in this file; add one at the very top
            $content = "import { useLocation } from ""react-router-dom"";`r`n" + $content
            $changed = $true
        }
    }

    # --- 2. Insert `const location = useLocation();` right before the line that
    #        builds URLSearchParams from window.location.search, and swap the
    #        reference in that same line. ---
    $searchLinePattern = '(?m)^(\s*)const\s+(\w+)\s*=\s*new URLSearchParams\(window\.location\.search\);\s*$'
    if ($content -match $searchLinePattern) {
        $indent   = $Matches[1]
        $varName  = $Matches[2]
        $oldLine  = $Matches[0]
        $newBlock = "${indent}const location = useLocation();`r`n${indent}const $varName = new URLSearchParams(location.search);"
        $content = $content.Replace($oldLine, $newBlock)
        $changed = $true
    }

    if ($changed -and ($content -ne $originalContent)) {
        Set-Content -Path $file -Value $content -Encoding UTF8 -NoNewline
        Write-Host "PATCHED: $file" -ForegroundColor Green
    } elseif ($content -match 'useLocation\(\)' -and $content -match 'location\.search') {
        Write-Host "ALREADY PATCHED: $file" -ForegroundColor Yellow
    } else {
        Write-Host "WARNING: Could not confidently patch $file -- pattern not found or already non-standard. Review manually." -ForegroundColor Red
        $anyFailed = $true
    }
}

Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
foreach ($file in $files) {
    if (-not (Test-Path $file)) { continue }
    $stillBroken = Select-String -Path $file -Pattern 'window\.location\.search' -Quiet
    $hasFix      = Select-String -Path $file -Pattern 'useLocation\(\)' -Quiet
    if ($stillBroken) {
        Write-Host "  STILL BROKEN: $file still references window.location.search" -ForegroundColor Red
        $anyFailed = $true
    } elseif ($hasFix) {
        Write-Host "  OK: $file" -ForegroundColor Green
    } else {
        Write-Host "  UNKNOWN STATE: $file (please review manually)" -ForegroundColor Yellow
    }
}

if ($anyFailed) {
    Write-Host ""
    Write-Host "One or more files could not be auto-patched. Review the .bak files and warnings above" -ForegroundColor Red
    Write-Host "before proceeding, or patch them manually in an editor." -ForegroundColor Red
    Write-Host "Aborting before build/deploy." -ForegroundColor Red
    exit 1
}

# --- Build + deploy (same safe pattern as Deploy-Production.ps1) ---
$envPath = ".\.env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env.local not found." -ForegroundColor Red
    exit 1
}

$envBackupPath = ".\.env.local.before-hashrouter-fix.bak"
Copy-Item -Path $envPath -Destination $envBackupPath -Force

$envContent = @"
VITE_DATA_SOURCE=base44
VITE_BASE44_FUNCTIONS_VERSION=prod
VITE_BASE44_APP_BASE_URL=$baseUrl
VITE_BASE44_SERVER_URL=https://base44.app
VITE_BASE44_APP_ID=$appId
"@
Set-Content -Path $envPath -Value $envContent -Encoding UTF8

Write-Host ""
Write-Host "=== Building for target: $Target ($appId) ===" -ForegroundColor Cyan
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

# Verify data source + app id baked in correctly before deploying
$dataSourceOk = $false
$appIdOk = $false
$builtFiles = Get-ChildItem .\dist\assets\*.js -ErrorAction SilentlyContinue
foreach ($f in $builtFiles) {
    $c = Get-Content $f.FullName -Raw
    if ($c -match '\["mock","local","salesforce-mock"\]\.includes\(([^)]*)\)') {
        Write-Host "  Data source check ($($f.Name)): $($Matches[0])"
        if ($Matches[0] -match '"base44"') { $dataSourceOk = $true }
    }
    if ($c -match [regex]::Escape($appId)) { $appIdOk = $true }
}

if (-not $dataSourceOk -or -not $appIdOk) {
    Write-Host ""
    Write-Host "ABORTING: Build verification failed (data source or app id not correctly baked in)." -ForegroundColor Red
    Write-Host "Check for a lingering shell environment variable: Get-ChildItem Env: | Where-Object Name -like '*VITE*'" -ForegroundColor Yellow
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 1
}

Write-Host ""
Write-Host "Build verified clean." -ForegroundColor Green

if ($PatchOnly) {
    Write-Host ""
    Write-Host "PatchOnly mode: skipping deploy. .env.local will be restored now." -ForegroundColor Yellow
    Copy-Item -Path $envBackupPath -Destination $envPath -Force
    exit 0
}

Write-Host ""
Write-Host "=== Deploying to $Target ($appId) with --no-build ===" -ForegroundColor Cyan
base44 deploy --app-id $appId --no-build --yes

Write-Host ""
Write-Host "Restoring your original .env.local..." -ForegroundColor Cyan
Copy-Item -Path $envBackupPath -Destination $envPath -Force

Write-Host ""
Write-Host "Done. Open $baseUrl in a fresh incognito window (Disable cache checked), hard reload," -ForegroundColor Green
Write-Host "create/open a quote, and confirm Quote Details now loads instead of 'Quote not found'." -ForegroundColor Green
