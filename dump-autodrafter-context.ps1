<#
  dump-autodrafter-context.ps1

  Read-only. Dumps lines 200-260 of src\pages\AutoDrafter.jsx (with line numbers) to
  both the terminal and a text file, so the broken "dedupedQualifyingRows" function
  signature around line 239 can be safely diagnosed before patching. Makes NO changes.
#>

$targetFile = Join-Path (Get-Location) "src\pages\AutoDrafter.jsx"

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
    exit 1
}

$lines = Get-Content -Path $targetFile -Encoding UTF8

$start = 199  # 0-based index for line 200
$end = 259    # 0-based index for line 260
if ($end -ge $lines.Count) { $end = $lines.Count - 1 }

Write-Host "==============================================="
Write-Host " AutoDrafter.jsx lines 200-260"
Write-Host "==============================================="

$outLines = @()
for ($i = $start; $i -le $end; $i++) {
    $lineNum = $i + 1
    $formatted = "{0,5}: {1}" -f $lineNum, $lines[$i]
    Write-Host $formatted
    $outLines += $formatted
}

$outFile = Join-Path (Get-Location) "autodrafter-context-200-260.txt"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($outFile, $outLines, $utf8NoBom)

Write-Host ""
Write-Host "Also saved to: $outFile"
Write-Host "==============================================="
