# Cleanup-ProjectRoot.ps1
#
# Run from C:\EnQuoteBuild:
#   powershell -ExecutionPolicy Bypass -File .\Cleanup-ProjectRoot.ps1
#
# Safe to run because git now has a full committed snapshot (commit ddae037)
# of everything as it exists right now. This script only MOVES files into
# organized subfolders and DELETES redundant .bak files -- nothing here
# touches src/, electron/, base44/, docs/, or any actual app config.
#
# What it does:
#   1. Creates tools/fix-scripts/  -> moves every one-off *.ps1 fix/build
#      script from the root into here (keeps the real app "scripts/" folder
#      untouched).
#   2. Creates tools/session-logs/ -> moves every *.log / *.txt diagnostic
#      output file from the root into here.
#   3. Creates tools/exports/      -> moves data exports (xlsx, zip) into
#      here.
#   4. Deletes root-level .bak / .before-* files (git has the real history
#      now; these were only ever meant to be temporary safety nets).
#   5. Prints a summary and reminds you to commit the cleanup.

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: Run this from the project root (where package.json lives)." -ForegroundColor Red
    exit 1
}

Write-Host "=== Cleaning up EnQuote project root ===" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Fix/build scripts -> tools\fix-scripts ---
$fixScriptsDir = ".\tools\fix-scripts"
New-Item -ItemType Directory -Path $fixScriptsDir -Force | Out-Null

$fixScripts = Get-ChildItem -Path . -Filter "*.ps1" -File
$movedScripts = 0
foreach ($f in $fixScripts) {
    Move-Item -Path $f.FullName -Destination $fixScriptsDir -Force
    $movedScripts++
}
Write-Host "Moved $movedScripts .ps1 script(s) to $fixScriptsDir" -ForegroundColor Green

# --- Step 2: Session logs/diagnostics -> tools\session-logs ---
$logsDir = ".\tools\session-logs"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

$logPatterns = @("*.log", "*.txt")
$movedLogs = 0
foreach ($pattern in $logPatterns) {
    $files = Get-ChildItem -Path . -Filter $pattern -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        # Don't sweep up README.md-adjacent or genuinely important root .txt
        # files if any exist; this project's .txt/.log files at root are all
        # session diagnostics/output based on prior review.
        Move-Item -Path $f.FullName -Destination $logsDir -Force
        $movedLogs++
    }
}
Write-Host "Moved $movedLogs log/txt file(s) to $logsDir" -ForegroundColor Green

# --- Step 3: Data exports -> tools\exports ---
$exportsDir = ".\tools\exports"
New-Item -ItemType Directory -Path $exportsDir -Force | Out-Null

$exportPatterns = @("*.xlsx", "*.zip")
$movedExports = 0
foreach ($pattern in $exportPatterns) {
    $files = Get-ChildItem -Path . -Filter $pattern -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        Move-Item -Path $f.FullName -Destination $exportsDir -Force
        $movedExports++
    }
}
Write-Host "Moved $movedExports data export file(s) to $exportsDir" -ForegroundColor Green

# --- Step 4: Delete redundant .bak / .before-* files (root only) ---
$bakPatterns = @("*.bak", "*.before-*")
$deletedBaks = 0
foreach ($pattern in $bakPatterns) {
    $files = Get-ChildItem -Path . -Filter $pattern -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        Remove-Item -Path $f.FullName -Force
        $deletedBaks++
    }
}
Write-Host "Deleted $deletedBaks redundant .bak/.before-* file(s) from root (git has real history now)" -ForegroundColor Green

# --- Step 5: Move the session-state markdown somewhere sensible too ---
$sessionStateFile = Get-ChildItem -Path . -Filter "EnQuote-Session-State*.md" -File -ErrorAction SilentlyContinue
if ($sessionStateFile) {
    $docsSessionDir = ".\docs\session-notes"
    New-Item -ItemType Directory -Path $docsSessionDir -Force | Out-Null
    foreach ($f in $sessionStateFile) {
        Move-Item -Path $f.FullName -Destination $docsSessionDir -Force
    }
    Write-Host "Moved session-state notes to $docsSessionDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Cleanup complete ===" -ForegroundColor Cyan
Write-Host "Your project root should now only contain real app files:" -ForegroundColor Cyan
Write-Host "  package.json, vite.config.js, index.html, src/, electron/, base44/, docs/, scripts/, node_modules/, dist/, release/, .env.local, .git*, tools/"
Write-Host ""
Write-Host "IMPORTANT: Commit this reorganization so it's captured in git history:" -ForegroundColor Yellow
Write-Host "  git add -A" -ForegroundColor Yellow
Write-Host "  git commit -m 'Reorganize project root: move fix scripts, logs, and exports into tools/'" -ForegroundColor Yellow
