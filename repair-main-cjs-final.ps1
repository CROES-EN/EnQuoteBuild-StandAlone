<#
  repair-main-cjs-final.ps1

  Fixes ALL remaining issues in electron\main.cjs identified from the full file
  review, based on what each endpoint actually returns:

    /api/base44/webhook/snapshot        -> {quotes: [...]}          (no "ok" field)
    /api/base44/webhook/snapshot-meta   -> {ok: true, lastSavedAt}
    /api/base44/webhook/presence        -> {ok: true, sessions: [...]}

  Specific fixes applied:

    Fix A: fetchRemoteSnapshot() is missing its own function declaration line
           (deleted at some point, leaving an orphaned header fragment above
           "return new Promise(...)"). Re-adds the missing line.

    Fix B: Inside fetchRemoteSnapshot(), the header used "remoteConfig.secret"
           instead of this function's own "secret" parameter (remoteConfig
           doesn't exist in this function's scope - it's a parameter named
           "secret"). Fixes it to use "secret".

    Fix C: Inside fetchRemoteSnapshot(), the success check was
           "if (!parsed.ok)" but /snapshot returns {quotes:[...]} with no
           "ok" field - fixes it to "if (!parsed.quotes || !Array.isArray(...))".

    Fix D: Inside pollRemoteSyncSource() (the /snapshot-meta poller), the
           success check was checking "!parsed.quotes" but /snapshot-meta
           returns {ok:true, lastSavedAt} with no "quotes" field - fixes it
           to "if (!parsed.ok)".

    Fix E: Inside fetchRemotePresenceList(), the header used "remoteConfig.secret"
           instead of this function's own "secret" parameter. Fixes it, and
           removes a leftover unused "CF-Access-Client-Secret" header line
           (Cloudflare Access was removed from this Worker earlier, so this
           header is no longer needed and its env var is unset).

    Fix F: Inside the "diagnostics:send" IPC handler, the postJson() call used
           "remoteConfig.secret" directly, which throws if remoteConfig is null
           (a host machine has no remote-sync-config.json). This handler already
           computes a safe "secret" variable above it - fixes it to use that,
           and removes the leftover CF-Access header line.

    Fix G: Same issue as Fix F, inside "presence:announce".
    Fix H: Same issue as Fix F, inside "presence:remove".

  Always backs up the file first. Each fix reports success or "not found" (in
  case wording differs slightly) rather than silently doing nothing. Safe to
  re-run - already-fixed patterns are simply skipped.

  How to run:
    From your project root (the folder with package.json):
        .\repair-main-cjs-final.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs Final Repair Script"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
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
$fixCount = 0

function Apply-Fix {
    param(
        [string]$Name,
        [string]$Pattern,
        [string]$Replacement
    )
    $script:content0 = $script:content
    if ($script:content -match $Pattern) {
        $script:content = [regex]::Replace($script:content, $Pattern, $Replacement)
        Write-Host "$Name : APPLIED" -ForegroundColor Green
        $script:fixCount++
    } else {
        Write-Host "$Name : pattern not found (may already be fixed, or wording differs)" -ForegroundColor Yellow
    }
}

# --- Fix A: missing function declaration for fetchRemoteSnapshot -----------

$patternA = '(?s)"Authorization":\s*`Bearer \$\{secret \|\| ""\}`,\s*return new Promise\(\(resolve, reject\) =>\s*\{'
$replacementA = 'function fetchRemoteSnapshot(urlString, secret) {' + "`r`n" + '    return new Promise((resolve, reject) => {'
Apply-Fix -Name "Fix A (missing fetchRemoteSnapshot declaration)" -Pattern $patternA -Replacement $replacementA

# --- Fix B + C: fetchRemoteSnapshot's header secret + success check --------
# Combined into one regex since they're close together and uniquely bounded by
# the function declaration Fix A just added, through its first "if (!parsed..." check.

$patternBC = '(?s)(function fetchRemoteSnapshot\(urlString, secret\) \{.*?)"Authorization": `Bearer \$\{remoteConfig\.secret \|\| ""\}`,(.*?)if \(!parsed\.ok\) \{'
$replacementBC = '${1}"Authorization": `Bearer ${secret || ""}`,${2}if (!parsed.quotes || !Array.isArray(parsed.quotes)) {'
Apply-Fix -Name "Fix B+C (fetchRemoteSnapshot header + success check)" -Pattern $patternBC -Replacement $replacementBC

# --- Fix D: pollRemoteSyncSource's meta check (swapped the wrong direction) -

$patternD = '(?s)(Meta check responded with HTTP \$\{res\.statusCode\}`\);\s*return;\s*\}\s*try \{\s*const parsed = JSON\.parse\(raw\);\s*)if \(!parsed\.quotes \|\| !Array\.isArray\(parsed\.quotes\)\) \{'
$replacementD = '${1}if (!parsed.ok) {'
Apply-Fix -Name "Fix D (snapshot-meta success check)" -Pattern $patternD -Replacement $replacementD

# --- Fix E: fetchRemotePresenceList header + remove leftover CF-Access line -

$patternE = '(?s)(function fetchRemotePresenceList\(urlString, secret\) \{.*?)"Authorization": `Bearer \$\{remoteConfig\.secret \|\| ""\}`,\s*\r?\n\s*"CF-Access-Client-Secret": process\.env\.CF_ACCESS_CLIENT_SECRET(\s*\})'
$replacementE = '${1}"Authorization": `Bearer ${secret || ""}`,${2}'
Apply-Fix -Name "Fix E (fetchRemotePresenceList header)" -Pattern $patternE -Replacement $replacementE

# --- Fix F: diagnostics:send handler ----------------------------------------

$patternF = '(?s)(`\$\{targetBase\}/api/base44/webhook/diagnostic-report`,\s*\{\s*)"Authorization": `Bearer \$\{remoteConfig\.secret \|\| ""\}`,\s*\r?\n\s*"CF-Access-Client-Secret": process\.env\.CF_ACCESS_CLIENT_SECRET(\s*\},)'
$replacementF = '${1}"Authorization": `Bearer ${secret}`${2}'
Apply-Fix -Name "Fix F (diagnostics:send header)" -Pattern $patternF -Replacement $replacementF

# --- Fix G: presence:announce handler ---------------------------------------

$patternG = '(?s)(`\$\{targetBase\}/api/base44/webhook/presence/announce`, \{\s*)"Authorization": `Bearer \$\{remoteConfig\.secret \|\| ""\}`,\s*\r?\n\s*"CF-Access-Client-Secret": process\.env\.CF_ACCESS_CLIENT_SECRET(\s*\}, payload\);)'
$replacementG = '${1}"Authorization": `Bearer ${secret}`${2}'
Apply-Fix -Name "Fix G (presence:announce header)" -Pattern $patternG -Replacement $replacementG

# --- Fix H: presence:remove handler -----------------------------------------

$patternH = '(?s)(`\$\{targetBase\}/api/base44/webhook/presence/remove`, \{\s*)"Authorization": `Bearer \$\{remoteConfig\.secret \|\| ""\}`,\s*\r?\n\s*"CF-Access-Client-Secret": process\.env\.CF_ACCESS_CLIENT_SECRET(\s*\}, payload\);)'
$replacementH = '${1}"Authorization": `Bearer ${secret}`${2}'
Apply-Fix -Name "Fix H (presence:remove header)" -Pattern $patternH -Replacement $replacementH

# --- Save if anything changed -----------------------------------------------

Write-Host ""
if ($content -ne $originalContent) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)
    Write-Host "SUCCESS - $fixCount fix(es) applied and file saved." -ForegroundColor Green
} else {
    Write-Host "No changes were made - none of the patterns matched." -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Restore backup if needed with:"
Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"

# --- Verify syntax -----------------------------------------------------------

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
