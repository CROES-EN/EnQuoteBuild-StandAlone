<#
  repair-main-cjs-v4.ps1

  Precise, line-number-based fix based on confirmed output: removes the leftover
  duplicate comment block + orphaned closing brace at lines 1158-1164 (exact content
  confirmed via check-line-1164.ps1), which is what remained after v3's removal of
  the duplicate readBundledSyncSecret() function body.

  Finds the block by matching its exact text (not fixed line numbers, in case
  anything shifted), so it's safe even if line numbers moved slightly.

  Always backs up first. Safe to re-run - if the pattern isn't found (already fixed),
  it says so and does nothing.

  How to run:
    From your project root (the folder with package.json):
        .\repair-main-cjs-v4.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs Repair Script v4"
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

$lines = Get-Content -Path $targetFile -Encoding UTF8

# Find the exact leftover block:
#   }
#   // Reads a secret bundled into the packaged app itself (via electron-builder's
#   // extraResources), so a fresh install never needs the user to type anything.
#   // This file is NOT committed to git - it's only added to the build output at
#   // package time. Falls back to null if this build wasn't packaged with one
#   // (e.g. a dev-mode run), in which case the existing manual-prompt flow below
#   // is completely unchanged and still works exactly as before.
#   }
#
# We look for the specific comment line unique to this duplicate ("Reads a secret
# bundled into the packaged app itself"), confirm the line right after the LAST
# comment line is a lone "}", and remove from the comment start through that brace.

$commentStartPattern = 'Reads a secret bundled into the packaged app itself'

$foundIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $commentStartPattern) {
        # We want the SECOND occurrence (the duplicate), not the first (legitimate) one.
        # Check: does a legitimate function definition immediately follow within the next
        # 8 lines? If yes, this is the FIRST (real) copy - skip it. If instead we hit a
        # lone "}" within the next 8 lines with no "function" line first, this is the
        # duplicate leftover - that's our target.
        $isDuplicate = $false
        for ($j = $i; $j -lt [Math]::Min($i + 8, $lines.Count); $j++) {
            if ($lines[$j] -match '^\s*function\s+readBundledSyncSecret') {
                $isDuplicate = $false
                break
            }
            if ($lines[$j] -match '^\s*\}\s*$' -and $j -gt $i) {
                $isDuplicate = $true
                $foundIndex = $i
                $endIndex = $j
                break
            }
        }
        if ($isDuplicate) { break }
    }
}

if ($foundIndex -eq -1) {
    Write-Host "Could not find the duplicate comment+brace block. It may already be fixed." -ForegroundColor Yellow
    Write-Host "No changes made."
} else {
    $removedLineCount = $endIndex - $foundIndex + 1
    Write-Host "Found duplicate block: lines $($foundIndex + 1) through $($endIndex + 1) ($removedLineCount lines)"
    Write-Host "Removing:"
    for ($k = $foundIndex; $k -le $endIndex; $k++) {
        Write-Host ("  {0,5}: {1}" -f ($k + 1), $lines[$k])
    }

    $newLines = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($i -ge $foundIndex -and $i -le $endIndex) { continue }
        $newLines += $lines[$i]
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($targetFile, $newLines, $utf8NoBom)

    Write-Host ""
    Write-Host "SUCCESS - removed $removedLineCount duplicate lines and saved." -ForegroundColor Green
}

Write-Host ""
Write-Host "Restore backup if needed with:"
Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"

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
