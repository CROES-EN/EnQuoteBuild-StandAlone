<#
  dump-autodrafter-context2.ps1

  Read-only. Dumps lines 245-280 of src\pages\AutoDrafter.jsx (with line numbers) to
  the terminal and a text file, to see the full mangled ternary expression around
  line 260 before patching it. Makes NO changes.
#>

$targetFile = Join-Path (Get-Location) "src\pages\AutoDrafter.jsx"

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
    exit 1
}

$lines = Get-Content -Path $targetFile -Encoding UTF8

$start = 244  # 0-based index for line 245
$end = 279    # 0-based index for line 280
if ($end -ge $lines.Count) { $end = $lines.Count - 1 }

Write-Host "==============================================="
Write-Host " AutoDrafter.jsx lines 245-280"
Write-Host "==============================================="

$outLines = @()
for ($i = $start; $i -le $end; $i++) {
    $lineNum = $i + 1
    $formatted = "{0,5}: {1}" -f $lineNum, $lines[$i]
    Write-Host $formatted
    $outLines += $formatted
}

$outFile = Join-Path (Get-Location) "autodrafter-context-245-280.txt"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($outFile, $outLines, $utf8NoBom)

Write-Host ""
Write-Host "Also saved to: $outFile"
Write-Host "==============================================="
