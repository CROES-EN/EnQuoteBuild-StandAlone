<#
  repair-main-cjs-v2.ps1

  Smarter version: instead of guessing which function needs "async", this script:
    1. Backs up electron\main.cjs first.
    2. Finds the line containing "await runStartupUpdateCheck".
    3. Scans BACKWARD from that line counting { and } to find the exact line
       that opens the function/block actually containing that await call
       (this is the real enclosing scope, which may be nested deeper than
       the outer app.whenReady().then(async () => { ... }) block).
    4. Checks whether that enclosing declaration already has "async".
       If not, inserts "async" in the correct spot for either:
         - "function name(...) {"       -> "async function name(...) {"
         - "(...) => {" / "(...) =>  {" -> "async (...) => {"
    5. Re-checks syntax with "node --check" and reports the result.

  Always safe to re-run. Always backs up first. Never guesses blindly - if it
  can't confidently identify the enclosing line, it stops and prints diagnostic
  info instead of making a risky edit.

  How to run:
    From your project root (the folder with package.json):
        .\repair-main-cjs-v2.ps1
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs Repair Script v2 (smart enclosing-scope fix)"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at:" -ForegroundColor Red
    Write-Host "  $targetFile"
    exit 1
}

# --- Step 1: Backup ---------------------------------------------------------

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"
Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created:"
Write-Host "  $backupFile"
Write-Host ""

# --- Step 2: Load lines ------------------------------------------------------

$lines = Get-Content -Path $targetFile -Encoding UTF8

# --- Step 3: Find the broken await line --------------------------------------

$targetIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'await\s+runStartupUpdateCheck\s*\(') {
        $targetIndex = $i
        break
    }
}

if ($targetIndex -eq -1) {
    Write-Host "Could not find a line matching 'await runStartupUpdateCheck(' - nothing to fix, or already fixed differently." -ForegroundColor Yellow
    exit 0
}

$lineNum = $targetIndex + 1
Write-Host "Found target line $lineNum :"
Write-Host "  $($lines[$targetIndex].Trim())"
Write-Host ""

# --- Step 4: Scan backward counting braces to find the enclosing block ------
#
# We start with a "debt" of 1, representing the one level of nesting between
# us and the enclosing block's opening brace. Going upward line by line:
#   - each '}' we see adds to the debt (we've entered ANOTHER closed block
#     that we need to skip past)
#   - each '{' we see pays down the debt
# When debt hits 0, that line contains the opening '{' of our real enclosing
# scope.
#
# This is a simple textual brace counter - it does not understand strings or
# comments, so if a line contains braces inside a string/comment it could
# throw off the count. Given this codebase's style (braces inside strings are
# rare here), this is a reasonable practical approach, and worst case we just
# won't find a confident match and will stop safely.

$debt = 1
$enclosingIndex = -1

for ($i = $targetIndex - 1; $i -ge 0; $i--) {
    $line = $lines[$i]
    $opens = ([regex]::Matches($line, '\{')).Count
    $closes = ([regex]::Matches($line, '\}')).Count

    $debt += $closes
    $debt -= $opens

    if ($debt -le 0) {
        $enclosingIndex = $i
        break
    }
}

if ($enclosingIndex -eq -1) {
    Write-Host "Could not confidently locate the enclosing function/block by brace-counting." -ForegroundColor Red
    Write-Host "No changes made. Please paste lines 1 through $lineNum for manual review."
    exit 1
}

$enclosingLineNum = $enclosingIndex + 1
$enclosingLine = $lines[$enclosingIndex]

Write-Host "Identified enclosing declaration at line $enclosingLineNum :"
Write-Host "  $($enclosingLine.Trim())"
Write-Host ""

# --- Step 5: Check if it's already async, fix if not ------------------------

if ($enclosingLine -match '\basync\b') {
    Write-Host "This enclosing line is ALREADY marked async." -ForegroundColor Yellow
    Write-Host "That means the real problem is a DIFFERENT, more deeply nested function -"
    Write-Host "the brace-counting may have found the wrong scope, or there is another"
    Write-Host "non-async function between this line and line $lineNum."
    Write-Host ""
    Write-Host "No changes made - please paste lines $($enclosingLineNum) through $lineNum so we can look closer."
    exit 0
}

$newLine = $null

if ($enclosingLine -match '^\s*function\s+\w+\s*\(') {
    # "function name(...) {"  ->  "async function name(...) {"
    $newLine = [regex]::Replace($enclosingLine, 'function(\s+\w+\s*\()', 'async function$1', 1)
}
elseif ($enclosingLine -match '\)\s*=>') {
    # "(...) => {"  ->  "async (...) => {"
    # Insert "async " immediately before the opening parenthesis of the
    # parameter list that precedes "=>" on this line.
    $newLine = [regex]::Replace($enclosingLine, '(\()([^()]*\)\s*=>)', 'async $1$2', 1)
}

if (-not $newLine -or $newLine -eq $enclosingLine) {
    Write-Host "Found the enclosing line, but couldn't confidently rewrite it automatically." -ForegroundColor Red
    Write-Host "Please manually add 'async' to this line, right before its parameter list:"
    Write-Host "  $($enclosingLine.Trim())"
    exit 1
}

$lines[$enclosingIndex] = $newLine

Write-Host "Updated line $enclosingLineNum to:"
Write-Host "  $($newLine.Trim())"
Write-Host ""

# --- Step 6: Save ------------------------------------------------------------

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($targetFile, $lines, $utf8NoBom)

Write-Host "SUCCESS - file updated and saved." -ForegroundColor Green
Write-Host ""

# --- Step 7: Verify syntax ----------------------------------------------------

Write-Host "Verifying syntax with 'node --check'..."
$checkResult = & node --check $targetFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED - main.cjs parses cleanly." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED - there may be another issue further in the file:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host ""
    Write-Host "You can restore the backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
