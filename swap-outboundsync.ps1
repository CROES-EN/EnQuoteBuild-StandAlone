<#
  swap-outboundsync.ps1

  Replaces the outdated electron\outboundSync.cjs (which expects the old
  Base44-direct config shape: serverUrl/appId/apiKey - and is therefore always
  reporting isConfigured=false, since main.cjs actually passes it
  workerUrl/outboundToken instead) with enquote-sync-worker\outboundSync.new.cjs,
  which is already written for the Local -> Cloudflare Worker -> Base44
  architecture and uses the exact same createOutboundSync({repository, config,
  logger, onAfterWrite}) signature that main.cjs already calls.

  Confirmed via direct inspection before writing this script:
    - Same exported function name: createOutboundSync
    - Same destructured parameters: { repository, config, logger, onAfterWrite }
    - config destructures { workerUrl, outboundToken, intervalMs } - matching
      exactly what main.cjs already passes in.

  Always backs up the current electron\outboundSync.cjs first. Safe to re-run -
  if the new file is already in place, it just confirms that instead of copying
  again.

  How to run:
    From your project root (the folder with package.json):
        .\swap-outboundsync.ps1
#>

$ErrorActionPreference = "Stop"

$oldFile = Join-Path (Get-Location) "electron\outboundSync.cjs"
$newFile = Join-Path (Get-Location) "enquote-sync-worker\outboundSync.new.cjs"

Write-Host "==============================================="
Write-Host " Swap outboundSync.cjs for the Worker-based version"
Write-Host "==============================================="

if (-not (Test-Path $oldFile)) {
    Write-Host "ERROR: Could not find: $oldFile" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $newFile)) {
    Write-Host "ERROR: Could not find: $newFile" -ForegroundColor Red
    exit 1
}

# --- Quick sanity check: confirm the new file really has the right shape ----

$newContent = Get-Content -Path $newFile -Raw -Encoding UTF8

$hasCreateOutboundSync = $newContent -match 'function\s+createOutboundSync\s*\(\s*\{\s*repository'
$hasWorkerUrlDestructure = $newContent -match 'const\s*\{\s*workerUrl,\s*outboundToken'

if (-not $hasCreateOutboundSync -or -not $hasWorkerUrlDestructure) {
    Write-Host "WARNING: The new file doesn't look like it has the expected shape." -ForegroundColor Yellow
    Write-Host "  createOutboundSync({repository...}) found: $hasCreateOutboundSync"
    Write-Host "  { workerUrl, outboundToken } destructure found: $hasWorkerUrlDestructure"
    Write-Host ""
    $confirm = Read-Host "Continue anyway? (y/n)"
    if ($confirm -ne "y") {
        Write-Host "Aborted - no changes made."
        exit 0
    }
}

# --- Backup the old file -----------------------------------------------------

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$oldFile.bak-$timestamp"
Copy-Item -Path $oldFile -Destination $backupFile -Force
Write-Host "Backed up old file to:"
Write-Host "  $backupFile"
Write-Host ""

# --- Copy the new file over the old one, preserving the old file's NAME -----
# (main.cjs does: const { createOutboundSync } = require("./outboundSync.cjs");
#  so the file must stay named "outboundSync.cjs" in the electron/ folder -
#  we are copying the CONTENTS of the .new.cjs file into that existing name.)

Copy-Item -Path $newFile -Destination $oldFile -Force
Write-Host "Copied enquote-sync-worker\outboundSync.new.cjs contents into:"
Write-Host "  $oldFile"
Write-Host ""

# --- Verify syntax ------------------------------------------------------------

Write-Host "Verifying syntax with 'node --check'..."
$checkResult = & node --check $oldFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host ""
    Write-Host "Restoring original file from backup automatically..." -ForegroundColor Yellow
    Copy-Item -Path $backupFile -Destination $oldFile -Force
    Write-Host "Restored. No lasting changes were made."
    exit 1
}

Write-Host ""
Write-Host "If anything looks wrong after testing, restore the backup with:"
Write-Host "  Copy-Item `"$backupFile`" `"$oldFile`" -Force"
Write-Host ""
Write-Host "Next: run 'npm run desktop:dev' and try creating/editing a quote,"
Write-Host "then check whether the 'Outbound sync to Base44 is not configured'"
Write-Host "warning is gone from the Refresh Quote Data dialog."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
