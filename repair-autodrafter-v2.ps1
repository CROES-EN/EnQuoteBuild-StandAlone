<#
  repair-autodrafter-v2.ps1

  Corrects the PREVIOUS fix (repair-autodrafter.ps1), which incorrectly turned this
  into a function declaration. Since "dedupedQualifyingRows" is used later in the
  file as an array/variable (dedupedQualifyingRows.filter(...), ": dedupedQualifyingRows"),
  it must be a variable assigned via a ternary + immediately-invoked function
  expression (IIFE), not a function declaration.

  Fixes BOTH ends:
    1. Opening: "function dedupedQualifyingRows(caseNumberCol) {"
       -> "const dedupedQualifyingRows = caseNumberCol\n    ? (() => {"
    2. Closing: the stray leftover
         }
         )
             ()
         :
             qualifyingRows;
       -> "      })()\n    : qualifyingRows;"

  Always backs up first. Safe to re-run.
#>

$ErrorActionPreference = "Stop"
$targetFile = Join-Path (Get-Location) "src\pages\AutoDrafter.jsx"

Write-Host "==============================================="
Write-Host " AutoDrafter.jsx Repair v2 (corrects previous fix)"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"
Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created: $backupFile"
Write-Host ""

$lines = Get-Content -Path $targetFile -Encoding UTF8

# --- Fix 1: the opening line -------------------------------------------------

$openIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*function\s+dedupedQualifyingRows\(caseNumberCol\)\s*\{\s*$') {
        $openIndex = $i
        break
    }
}

if ($openIndex -eq -1) {
    Write-Host "Could not find 'function dedupedQualifyingRows(caseNumberCol) {' - may already be fixed." -ForegroundColor Yellow
} else {
    $indent = ($lines[$openIndex] -replace '^(\s*).*', '$1')
    Write-Host "Found opening line at $($openIndex + 1): $($lines[$openIndex].Trim())"
    $lines[$openIndex] = "${indent}const dedupedQualifyingRows = caseNumberCol`n${indent}    ? (() => {"
    Write-Host "  -> replaced with:"
    Write-Host "     ${indent}const dedupedQualifyingRows = caseNumberCol"
    Write-Host "     ${indent}    ? (() => {"
    Write-Host ""
}

# Re-split in case the replacement above introduced an embedded newline in one element
$rejoined = ($lines -join "`n")
$lines = $rejoined -split "`n"

# --- Fix 2: the closing leftover fragment ------------------------------------
#
# Looking for this exact 5-line shape (post Fix-1, line numbers may have shifted,
# so we search fresh):
#   }
#   )
#       ()
#   :
#       qualifyingRows;

$closeStart = -1
for ($i = 0; $i -lt $lines.Count - 4; $i++) {
    if ($lines[$i].Trim() -eq "}" -and
        $lines[$i+1].Trim() -eq ")" -and
        $lines[$i+2].Trim() -eq "()" -and
        $lines[$i+3].Trim() -eq ":" -and
        $lines[$i+4].Trim() -match '^qualifyingRows;?$') {
        $closeStart = $i
        break
    }
}

if ($closeStart -eq -1) {
    Write-Host "Could not find the broken closing fragment - may already be fixed, or shape differs." -ForegroundColor Yellow
} else {
    Write-Host "Found broken closing fragment at lines $($closeStart + 1) through $($closeStart + 5):"
    for ($k = $closeStart; $k -le $closeStart + 4; $k++) {
        Write-Host ("  {0,5}: {1}" -f ($k + 1), $lines[$k])
    }

    $baseIndent = ($lines[$closeStart] -replace '^(\s*)\}.*', '$1')
    $newClosing = @(
        "${baseIndent}      })()"
        "${baseIndent}    : qualifyingRows;"
    )

    $newLines = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($i -eq $closeStart) {
            $newLines += $newClosing
            $i += 4  # skip the 5 original lines (this one + next 4)
            continue
        }
        $newLines += $lines[$i]
    }
    $lines = $newLines

    Write-Host "  -> replaced with:"
    Write-Host "     $($newClosing[0])"
    Write-Host "     $($newClosing[1])"
    Write-Host ""
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($targetFile, $lines, $utf8NoBom)

Write-Host "SUCCESS - file saved." -ForegroundColor Green
Write-Host ""
Write-Host "Restore backup if needed with:"
Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
Write-Host ""
Write-Host "Note: this is a .jsx file, so run 'npm run desktop:dev' to confirm the fix"
Write-Host "(node --check cannot validate JSX syntax directly)."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
