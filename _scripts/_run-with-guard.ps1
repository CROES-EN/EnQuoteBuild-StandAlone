param(
    [Parameter(Mandatory = $true)]
    [string]$TargetFile
)

$ErrorActionPreference = "Stop"
$historyPath = "C:\EnQuoteBuild\_script-output\run-history.jsonl"
$logPath = "C:\EnQuoteBuild\_script-output\latest-output.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $historyPath) | Out-Null

function Get-FileHashHex([string]$path) {
    $hash = Get-FileHash -Path $path -Algorithm SHA256
    return $hash.Hash
}

function Get-FirstMeaningfulLine([string]$path) {
    $lines = Get-Content -Path $path
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -and $trimmed -notmatch '^#' -and $trimmed -notmatch '^<#') {
            return $trimmed.Substring(0, [Math]::Min(80, $trimmed.Length))
        }
    }
    return "(no content)"
}

$currentHash = Get-FileHashHex -path $TargetFile

$history = @()
if (Test-Path $historyPath) {
    $history = Get-Content -Path $historyPath | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { $null }
    } | Where-Object { $_ -ne $null }
}

$priorMatch = $history | Where-Object { $_.hash -eq $currentHash } | Select-Object -Last 1

if ($priorMatch) {
    Write-Host ""
    Write-Host "===== DUPLICATE RUN DETECTED =====" -ForegroundColor Red
    Write-Host "The contents of run.ps1 are IDENTICAL to a run already completed:" -ForegroundColor Yellow
    Write-Host "  Previously run at : $($priorMatch.timestamp)" -ForegroundColor Yellow
    Write-Host "  First line was    : $($priorMatch.firstLine)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Running the SAME script content again could re-apply changes that" -ForegroundColor Yellow
    Write-Host "were already made (most of Copilot's scripts guard against this too," -ForegroundColor Yellow
    Write-Host "but this stops it before PowerShell even starts, just in case)." -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Type YES (all caps) to run it anyway, or anything else to cancel"
    if ($response -ne "YES") {
        Write-Host ""
        Write-Host "[CANCELLED] Nothing was run. Paste a NEW script into run.ps1 and save first." -ForegroundColor Cyan
        exit 0
    }
    Write-Host ""
    Write-Host "[CONFIRMED] Proceeding with re-run at your explicit request." -ForegroundColor Yellow
}

# Run the target file, capture all output, tee to log, copy to clipboard - same
# behavior as before, just now wrapped with the duplicate-check above.
& $TargetFile *>&1 | Tee-Object -FilePath $logPath | Out-Host
Get-Content $logPath -Raw | Set-Clipboard

# Record this run in history (append-only, trimmed to last 50 entries).
$entry = [pscustomobject]@{
    hash      = $currentHash
    timestamp = (Get-Date -Format o)
    firstLine = Get-FirstMeaningfulLine -path $TargetFile
}
$history += $entry
$trimmedHistory = $history | Select-Object -Last 50
$trimmedHistory | ForEach-Object { $_ | ConvertTo-Json -Compress } | Set-Content -Path $historyPath -Encoding utf8

Write-Host ""
Write-Host "[COPIED] Full output copied to clipboard - paste directly into chat with Ctrl+V." -ForegroundColor Magenta
