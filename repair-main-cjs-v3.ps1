<#
  repair-main-cjs-v3.ps1

  Built directly from the exact broken text confirmed in the file, so it targets the
  real fragment instead of guessing at a pattern.

  Fixes:
    1. Removes the leftover duplicated fragment:
         outboundSync.start();
         // (duplicated leftover fragment - DELETE everything below this line, down through:)
           onAfterWrite: markOwnWrite
         });
         outboundSync.start();
       down to just the first, correct "outboundSync.start();" - this stray extra "});"
       was closing the whenReady().then(async () => { ... }) callback too early, which is
       why "await runStartupUpdateCheck()" further down was being treated as top-level
       (and .cjs files don't support top-level await).
    2. Removes the second, duplicate (zero-indented) copy of
       "function readBundledSyncSecret() { ... }" - harmless to leave, but it's dead
       duplicate code, so cleaned up here too.

  Always backs up first. Safe to re-run.

  How to run:
    From your project root (the folder with package.json):
        .\repair-main-cjs-v3.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs Repair Script v3"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at:" -ForegroundColor Red
    Write-Host "  $targetFile"
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"
Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created:"
Write-Host "  $backupFile"
Write-Host ""

$content = Get-Content -Path $targetFile -Raw -Encoding UTF8
$originalContent = $content
$changesMade = @()

# --- Fix 1: Remove the duplicated leftover outboundSync fragment -----------
#
# Matches from the literal marker comment through the trailing outboundSync.start();
# that follows the stray "});". Keeps the FIRST (correct) "outboundSync.start();"
# that appears just before this fragment untouched.

$fragmentPattern = '(?s)\r?\n//\s*\(duplicated leftover fragment.*?outboundSync\.start\(\);\r?\n'

if ($content -match $fragmentPattern) {
    $content = [regex]::Replace($content, $fragmentPattern, "`n")
    $changesMade += "Removed duplicated leftover outboundSync fragment (the extra premature closing brace)"
} else {
    Write-Host "Fix 1: exact marker-comment pattern not found - trying fallback pattern..." -ForegroundColor Yellow

    # Fallback: match the structural shape even without the comment, in case it was
    # already partially cleaned up: a lone "onAfterWrite: markOwnWrite" line followed
    # by "});" followed by "outboundSync.start();", directly after a real
    # "outboundSync.start();" line.
    $fallbackPattern = '(?s)(outboundSync\.start\(\);)\r?\n(?:\r?\n)?(?://[^\r\n]*\r?\n)?\s*onAfterWrite:\s*markOwnWrite\r?\n\s*\}\);\r?\n\s*outboundSync\.start\(\);'
    if ($content -match $fallbackPattern) {
        $content = [regex]::Replace($content, $fallbackPattern, '$1')
        $changesMade += "Removed duplicated leftover outboundSync fragment (fallback pattern)"
    } else {
        Write-Host "Fix 1: fallback pattern also not found - this fragment may already be removed." -ForegroundColor Yellow
    }
}

# --- Fix 2: Remove the duplicate zero-indented readBundledSyncSecret --------
#
# Keeps the first (properly indented, inside the callback) definition, removes the
# second copy that has no leading whitespace at all.

$duplicateFuncPattern = '(?s)\r?\nfunction readBundledSyncSecret\(\) \{\r?\ntry \{.*?\r?\n\}\r?\n'

if ($content -match $duplicateFuncPattern) {
    $content = [regex]::Replace($content, $duplicateFuncPattern, "`n")
    $changesMade += "Removed duplicate zero-indented readBundledSyncSecret() function"
} else {
    Write-Host "Fix 2: duplicate readBundledSyncSecret pattern not found - may already be fixed, or indentation differs." -ForegroundColor Yellow
}

# --- Save if anything changed ------------------------------------------------

if ($content -ne $originalContent) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)

    Write-Host ""
    Write-Host "SUCCESS - file updated:" -ForegroundColor Green
    foreach ($change in $changesMade) {
        Write-Host "  - $change"
    }
    Write-Host ""
    Write-Host "Restore backup if needed with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
} else {
    Write-Host ""
    Write-Host "No changes were made - patterns not found. Please share the exact lines" -ForegroundColor Cyan
    Write-Host "around 'onAfterWrite: markOwnWrite' so we can target it precisely."
}

# --- Verify syntax ------------------------------------------------------------

Write-Host ""
Write-Host "Verifying syntax with 'node --check'..."
$checkResult = & node --check $targetFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED - main.cjs parses cleanly." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host ""
    Write-Host "Restore backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
