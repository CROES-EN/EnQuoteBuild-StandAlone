<#
  check-line-1164.ps1

  Read-only. Prints lines 1145-1185 of electron\main.cjs with line numbers so we can
  see exactly what the Fix 2 removal left behind around the reported error line 1164.
  Makes no changes.
#>

$targetFile = Join-Path (Get-Location) "electron\main.cjs"

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
    exit 1
}

$lines = Get-Content -Path $targetFile -Encoding UTF8

$start = 1144  # 0-based index for line 1145
$end = 1184    # 0-based index for line 1185
if ($end -ge $lines.Count) { $end = $lines.Count - 1 }

Write-Host "==============================================="
Write-Host " Lines 1145-1185 of main.cjs"
Write-Host "==============================================="

for ($i = $start; $i -le $end; $i++) {
    $lineNum = $i + 1
    Write-Host ("{0,5}: {1}" -f $lineNum, $lines[$i])
}
