<#
  repair-autodrafter.ps1

  Fixes the mangled function signature in src\pages\AutoDrafter.jsx:

    function dedupedQualifyingRows

        = caseNumberCol
    )
    {

  which should be:

    function dedupedQualifyingRows(caseNumberCol) {

  (createdCol is used inside the function body via closure/outer scope, same pattern
  as omStatusCol/statusCol/commentCol earlier in the same file - not a parameter here.)

  Always backs up first. Safe to re-run.
#>

$ErrorActionPreference = "Stop"
$targetFile = Join-Path (Get-Location) "src\pages\AutoDrafter.jsx"

Write-Host "==============================================="
Write-Host " AutoDrafter.jsx Repair"
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

# Find "function dedupedQualifyingRows" (the broken multi-line declaration start)
$startIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'function\s+dedupedQualifyingRows\s*$') {
        $startIndex = $i
        break
    }
}

if ($startIndex -eq -1) {
    Write-Host "Could not find the broken 'function dedupedQualifyingRows' declaration." -ForegroundColor Yellow
    Write-Host "It may already be fixed."
    exit 0
}

# The broken declaration spans from startIndex through the line containing the
# opening "{" that begins the function body. Scan forward (a handful of lines is
# plenty here) to find that "{".
$endIndex = -1
for ($i = $startIndex; $i -lt [Math]::Min($startIndex + 8, $lines.Count); $i++) {
    if ($lines[$i].Trim() -eq "{") {
        $endIndex = $i
        break
    }
}

if ($endIndex -eq -1) {
    Write-Host "Found the start of the broken declaration but could not find its opening '{'." -ForegroundColor Red
    Write-Host "No changes made - please share a few more lines for manual review."
    exit 1
}

Write-Host "Found broken declaration: lines $($startIndex + 1) through $($endIndex + 1)"
Write-Host "Current content:"
for ($k = $startIndex; $k -le $endIndex; $k++) {
    Write-Host ("  {0,5}: {1}" -f ($k + 1), $lines[$k])
}
Write-Host ""

# Replace with a single, correct line. Preserve original indentation from the first line.
$indent = ($lines[$startIndex] -replace '^(\s*).*', '$1')
$replacementLine = "${indent}function dedupedQualifyingRows(caseNumberCol) {"

$newLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($i -eq $startIndex) {
        $newLines += $replacementLine
        continue
    }
    if ($i -gt $startIndex -and $i -le $endIndex) {
        continue  # skip these lines entirely - folded into the replacement above
    }
    $newLines += $lines[$i]
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($targetFile, $newLines, $utf8NoBom)

Write-Host "SUCCESS - replaced with:" -ForegroundColor Green
Write-Host "  $replacementLine"
Write-Host ""
Write-Host "Restore backup if needed with:"
Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
Write-Host ""
Write-Host "Note: this is a .jsx file, so 'node --check' cannot validate it directly"
Write-Host "(JSX syntax isn't plain JS). Please run 'npm run desktop:dev' to confirm."
Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
