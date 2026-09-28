<#
  diagnose-main-cjs.ps1

  Purpose: figure out WHERE the brace imbalance actually starts, instead of
  guessing at a fix blindly. This does not change main.cjs at all - it is
  read-only and completely safe to run as many times as you want.

  What it does:
    1. Reads electron\main.cjs line by line.
    2. Keeps a running "brace balance" count: +1 for every '{', -1 for every '}'.
    3. Prints the running balance every 20 lines, so you can see roughly where
       it starts drifting away from what's expected.
    4. Specifically prints the balance at a few key landmark lines we already
       know about (687, 1552, 1691) so we can see exactly how "unbalanced" the
       file is at each of those points.
    5. Dumps lines 680-1700 to a separate, easy-to-read text file
       (main-cjs-context-680-1700.txt) in your project root, since pasting long
       terminal output has been error-prone tonight.

  How to run:
    From your project root (the folder with package.json):
        .\diagnose-main-cjs.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at:" -ForegroundColor Red
    Write-Host "  $targetFile"
    exit 1
}

$lines = Get-Content -Path $targetFile -Encoding UTF8

Write-Host "==============================================="
Write-Host " main.cjs Diagnostic (read-only, no changes made)"
Write-Host "==============================================="
Write-Host "Total lines in file: $($lines.Count)"
Write-Host ""

$balance = 0
$landmarks = @(687, 1552, 1691)
$landmarkResults = @{}

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $opens = ([regex]::Matches($line, '\{')).Count
    $closes = ([regex]::Matches($line, '\}')).Count
    $balance += $opens
    $balance -= $closes

    $lineNum = $i + 1

    if ($landmarks -contains $lineNum) {
        $landmarkResults[$lineNum] = $balance
    }

    if ($lineNum % 20 -eq 0) {
        Write-Host ("Line {0,5}: running brace balance = {1}" -f $lineNum, $balance)
    }
}

Write-Host ""
Write-Host "Final brace balance at end of file: $balance"
if ($balance -eq 0) {
    Write-Host "  -> Balanced overall (0 is correct/expected)." -ForegroundColor Green
} else {
    Write-Host "  -> NOT balanced. A non-zero value means there's a real mismatch somewhere in the file." -ForegroundColor Red
}

Write-Host ""
Write-Host "Balance at known landmark lines:"
foreach ($ln in $landmarks) {
    if ($landmarkResults.ContainsKey($ln)) {
        Write-Host ("  Line {0}: balance = {1}" -f $ln, $landmarkResults[$ln])
    }
}

# --- Dump a readable context file -------------------------------------------

$startLine = 679   # 0-based index for line 680
$endLine = 1699    # 0-based index for line 1700 (inclusive range below)

if ($endLine -ge $lines.Count) { $endLine = $lines.Count - 1 }

$contextLines = @()
for ($i = $startLine; $i -le $endLine; $i++) {
    $lineNum = $i + 1
    $contextLines += ("{0,5}: {1}" -f $lineNum, $lines[$i])
}

$contextFile = Join-Path (Get-Location) "main-cjs-context-680-1700.txt"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($contextFile, $contextLines, $utf8NoBom)

Write-Host ""
Write-Host "Wrote lines 680-1700 (with line numbers) to:"
Write-Host "  $contextFile"
Write-Host ""
Write-Host "Open that file and share its contents - it will show exactly where"
Write-Host "the brace count starts drifting, using the line numbers on the left."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done (no changes were made to main.cjs)"
Write-Host "==============================================="
