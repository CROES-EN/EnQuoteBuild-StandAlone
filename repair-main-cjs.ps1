<#
  repair-main-cjs.ps1

  Fixes electron\main.cjs:
    1. Removes the leftover duplicated tail from the outboundSync config
       migration (the broken "onAfterWrite: markOwnWrite }); outboundSync.start();"
       fragment left over after the serverUrl/appId/apiKey -> workerUrl/outboundToken
       config switch).
    2. Marks runStartupUpdateCheck() as an async function, since it's called with
       "await runStartupUpdateCheck();" further down in the file.

  Always backs up the file first (timestamped .bak) before changing anything.
  Safe to run more than once - if a pattern is already fixed, it just reports that
  and moves on instead of breaking anything.

  How to run:
    From your project root (the folder with package.json):
        .\repair-main-cjs.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs Repair Script"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at:" -ForegroundColor Red
    Write-Host "  $targetFile"
    Write-Host ""
    Write-Host "Make sure you run this script from your project root"
    Write-Host "(the folder that contains package.json and the 'electron' folder)."
    exit 1
}

Write-Host "Found target file:"
Write-Host "  $targetFile"
Write-Host ""

# --- Step 1: Backup -------------------------------------------------------

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"

Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created:"
Write-Host "  $backupFile"
Write-Host ""

# --- Step 2: Load content --------------------------------------------------

$content = Get-Content -Path $targetFile -Raw -Encoding UTF8
$originalContent = $content
$changesMade = @()

# --- Fix 1: Remove duplicated leftover outboundSync tail -------------------
#
# Looks for the correct, complete block:
#   ...outboundToken: ... }, onAfterWrite: markOwnWrite });
#   outboundSync.start();
# immediately followed by the broken leftover duplicate:
#   onAfterWrite: markOwnWrite
#   });
#   outboundSync.start();
#
# and removes just the duplicated leftover, keeping the first (correct) copy.

$duplicateTailPattern = '(?s)(outboundSync\.start\(\);\s*)\r?\n\s*onAfterWrite:\s*markOwnWrite\s*\r?\n\s*\}\);\s*\r?\n\s*outboundSync\.start\(\);'

if ($content -match $duplicateTailPattern) {
    $content = [regex]::Replace(
        $content,
        $duplicateTailPattern,
        '$1'
    )
    $changesMade += "Removed duplicated leftover outboundSync config fragment"
} else {
    Write-Host "Fix 1 (duplicate outboundSync tail): pattern not found - may already be fixed." -ForegroundColor Yellow
}

# --- Fix 2: Make runStartupUpdateCheck async --------------------------------
#
# Before: function runStartupUpdateCheck() {
# After:  async function runStartupUpdateCheck() {
#
# Only touches the declaration itself, and only if it isn't already async.

$funcPattern = '(?<!async )function runStartupUpdateCheck\s*\('

if ($content -match $funcPattern) {
    $content = [regex]::Replace(
        $content,
        $funcPattern,
        'async function runStartupUpdateCheck('
    )
    $changesMade += "Marked runStartupUpdateCheck() as async"
} else {
    Write-Host "Fix 2 (runStartupUpdateCheck async): pattern not found - may already be fixed." -ForegroundColor Yellow
}

# --- Step 3: Save if anything changed --------------------------------------

if ($content -ne $originalContent) {
    # Write back as UTF-8 WITHOUT BOM (BOM caused a real bug earlier tonight)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)

    Write-Host ""
    Write-Host "SUCCESS - file updated:" -ForegroundColor Green
    foreach ($change in $changesMade) {
        Write-Host "  - $change"
    }
    Write-Host ""
    Write-Host "If anything looks wrong, restore the backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
} else {
    Write-Host ""
    Write-Host "No changes were made - file already matches the expected fixed state." -ForegroundColor Cyan
}

# --- Step 4: Verify the file parses cleanly ---------------------------------

Write-Host ""
Write-Host "Verifying syntax with 'node --check'..."
$checkResult = node --check $targetFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED - main.cjs parses cleanly." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED - there may be another issue:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host ""
    Write-Host "You can restore the backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
