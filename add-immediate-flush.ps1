<#
  add-immediate-flush.ps1

  Makes every local write immediately attempt an outbound sync, instead of
  waiting for the next 30-second timer tick.

  Modifies the ownWrite() wrapper in electron\main.cjs - since EVERY quote,
  product, and collection mutation (create/update/delete/bulkUpdate/reset/
  import) already goes through this single wrapper, this one change covers
  all of them at once (confirmed via direct search of every quotes:*/
  products:*/collections:* handler in the file).

  The flush is fire-and-forget (not awaited) so:
    - Saving a quote in the UI stays fast - it doesn't wait for the network
      round-trip to the Worker before returning.
    - If the flush fails (network hiccup, Worker temporarily down), the
      quote is NOT lost - it stays queued locally and the existing 30s
      timer will pick it up and retry automatically on the next cycle.

  Always backs up main.cjs first. Safe to re-run - if already applied, it
  reports that and makes no changes.

  How to run:
    From your project root (the folder with package.json):
        .\add-immediate-flush.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " Add Immediate Outbound Flush on Every Write"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find: $targetFile" -ForegroundColor Red
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

# Already applied? (idempotency check)
if ($content -match 'Immediate flush failed \(will retry on next cycle\)') {
    Write-Host "Already applied - no changes needed." -ForegroundColor Cyan
    exit 0
}

$oldPattern = '(?s)const ownWrite = \(fn\) => async \(\.\.\.args\) => \{\s*const result = await fn\(\.\.\.args\);\s*markOwnWrite\(\);\s*return result;\s*\};'

$newBlock = @'
const ownWrite = (fn) => async (...args) => {
    const result = await fn(...args);
    markOwnWrite();
    // Immediately attempt to push this change out (Local -> Cloudflare Worker ->
    // Base44) instead of waiting for the next 30s timer tick. Fire-and-forget:
    // doesn't block the save from returning to the renderer, and if it fails
    // (network hiccup, Worker temporarily unreachable) the change is NOT lost -
    // it stays queued locally and the existing interval timer retries it
    // automatically on the next cycle.
    if (outboundSync) {
        outboundSync.flush().catch((error) => {
            console.warn("[outbound-sync] Immediate flush failed (will retry on next cycle):", error.message);
        });
    }
    return result;
};
'@

if ($content -match $oldPattern) {
    $content = [regex]::Replace($content, $oldPattern, $newBlock)
    Write-Host "Applied: ownWrite() now triggers an immediate outbound flush." -ForegroundColor Green
} else {
    Write-Host "Could not find the exact ownWrite() block to modify." -ForegroundColor Red
    Write-Host "No changes made. Current ownWrite() definition may have different formatting."
    exit 1
}

if ($content -ne $originalContent) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)
    Write-Host "File saved." -ForegroundColor Green
}

Write-Host ""
Write-Host "Verifying syntax with 'node --check'..."
$checkResult = & node --check $targetFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host ""
    Write-Host "Restoring original file from backup automatically..." -ForegroundColor Yellow
    Copy-Item -Path $backupFile -Destination $targetFile -Force
    Write-Host "Restored. No lasting changes were made."
    exit 1
}

Write-Host ""
Write-Host "Restore backup if needed with:"
Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
Write-Host ""
Write-Host "Next: run 'npm run desktop:dev', create or edit a quote, and watch the"
Write-Host "terminal for an outbound-sync log line firing immediately (not after 30s)."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
