<#
  pinpoint-main-cjs.ps1

  Read-only diagnostic. Finds the EXACT line where the brace balance drops
  back down to 0 after line 687 (where app.whenReady().then(async () => {
  opens), which is the premature/extra closing brace causing the
  "await runStartupUpdateCheck()" syntax error at line 1691.

  Makes NO changes to main.cjs. Safe to run as many times as you want.

  How to run:
    From your project root (the folder with package.json):
        .\pinpoint-main-cjs.ps1
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
Write-Host " Pinpointing premature closing brace"
Write-Host "==============================================="

# Find the "app.whenReady().then(" line automatically, in case line numbers
# have shifted since earlier in the session.
$startIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'app\.whenReady\(\)\.then\(') {
        $startIndex = $i
        break
    }
}

if ($startIndex -eq -1) {
    Write-Host "Could not find 'app.whenReady().then(' anywhere in the file." -ForegroundColor Red
    exit 1
}

$startLineNum = $startIndex + 1
Write-Host "Found 'app.whenReady().then(' at line $startLineNum"
Write-Host "  $($lines[$startIndex].Trim())"
Write-Host ""

# Find the "await runStartupUpdateCheck" line the same way.
$targetIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'await\s+runStartupUpdateCheck\s*\(') {
        $targetIndex = $i
        break
    }
}

if ($targetIndex -eq -1) {
    Write-Host "Could not find 'await runStartupUpdateCheck(' anywhere in the file." -ForegroundColor Red
    exit 1
}

$targetLineNum = $targetIndex + 1
Write-Host "Found 'await runStartupUpdateCheck(' at line $targetLineNum"
Write-Host ""

# Walk forward from startIndex, tracking balance starting at 0 on that same
# line (the '{' at the end of that line brings it to 1). Report the FIRST
# line, after that, where balance returns to 0 - that is the premature close.

$balance = 0
$firstZeroAfterStart = -1

for ($i = $startIndex; $i -le $targetIndex; $i++) {
    $line = $lines[$i]
    $opens = ([regex]::Matches($line, '\{')).Count
    $closes = ([regex]::Matches($line, '\}')).Count
    $balance += $opens
    $balance -= $closes

    # Skip the very start line itself (balance will be 1 right after it,
    # that's correct and expected).
    if ($i -eq $startIndex) { continue }

    if ($balance -eq 0 -and $firstZeroAfterStart -eq -1) {
        $firstZeroAfterStart = $i
        break
    }
}

if ($firstZeroAfterStart -eq -1) {
    Write-Host "Balance never returned to 0 between the start and target lines." -ForegroundColor Yellow
    Write-Host "This means the imbalance is happening AFTER line $targetLineNum instead - the"
    Write-Host "await line itself might genuinely be inside the right scope, and something"
    Write-Host "later in the file is the real problem. Re-examine node --check's line number"
    Write-Host "directly, or share lines $targetLineNum to end of file."
    exit 0
}

$closeLineNum = $firstZeroAfterStart + 1

Write-Host "===> Found it: the enclosing block prematurely closes at line $closeLineNum" -ForegroundColor Green
Write-Host ""
Write-Host "Context around that line:"
Write-Host "-----------------------------------------------"

$contextStart = [Math]::Max(0, $firstZeroAfterStart - 8)
$contextEnd = [Math]::Min($lines.Count - 1, $firstZeroAfterStart + 8)

for ($i = $contextStart; $i -le $contextEnd; $i++) {
    $marker = if ($i -eq $firstZeroAfterStart) { ">>> " } else { "    " }
    Write-Host ("{0}{1,5}: {2}" -f $marker, ($i + 1), $lines[$i])
}

Write-Host "-----------------------------------------------"
Write-Host ""
Write-Host "The line marked with >>> is almost certainly where an extra '}' (or '});')"
Write-Host "is closing the app.whenReady().then(async () => { ... }) callback too early."
Write-Host "Everything from that point until line $targetLineNum is now unintentionally"
Write-Host "sitting OUTSIDE the async callback, which is why 'await' fails there."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done (read-only - no changes were made)"
Write-Host "==============================================="
