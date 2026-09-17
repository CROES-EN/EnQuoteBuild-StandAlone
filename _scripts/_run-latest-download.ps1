$ErrorActionPreference = "Stop"
$downloadsDir = Join-Path $env:USERPROFILE "Downloads"
$historyPath = "C:\EnQuoteBuild\_script-output\run-history.jsonl"
$logPath = "C:\EnQuoteBuild\_script-output\latest-output.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $historyPath) | Out-Null

$candidate = Get-ChildItem -Path $downloadsDir -Filter "*.ps1" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $candidate) {
    Write-Host ""
    Write-Host "[ERROR] No .ps1 files found in $downloadsDir" -ForegroundColor Red
    Write-Host "Download a script from Copilot first, then press Ctrl+Alt+R." -ForegroundColor Yellow
    exit 1
}

$targetFile = $candidate.FullName

Write-Host ""
Write-Host "===== RUNNING MOST RECENTLY DOWNLOADED .ps1 FILE =====" -ForegroundColor Cyan
Write-Host "  File name : $($candidate.Name)" -ForegroundColor Cyan
Write-Host "  Full path : $targetFile" -ForegroundColor Cyan
Write-Host "  Modified  : $($candidate.LastWriteTime)" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This is whatever .ps1 file has the newest timestamp in Downloads right now." -ForegroundColor Yellow
Write-Host "If you did NOT just download a script and expect this to run, press Ctrl+C now." -ForegroundColor Yellow
Write-Host "Pausing 3 seconds..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

function Get-FileHashHex([string]$path) {
    return (Get-FileHash -Path $path -Algorithm SHA256).Hash
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

# Belt-and-suspenders array wrapping: @(...) around the whole pipeline PLUS the
# comma operator on return, so PowerShell can never silently collapse a
# single-item (or zero-item) result into a bare scalar.
function Get-RunHistory {
    $result = @()
    if (Test-Path $historyPath) {
        $result = @(Get-Content -Path $historyPath | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object { $_ -ne $null })
    }
    return ,@($result)
}

function Add-RunHistoryEntry([string]$hash, [string]$firstLine, [string]$fileName, [string]$mode) {
    $history = @(Get-RunHistory)
    $entry = [pscustomobject]@{
        hash      = $hash
        timestamp = (Get-Date -Format o)
        firstLine = $firstLine
        fileName  = $fileName
        mode      = $mode
    }
    $history = @($history) + @($entry)
    $trimmedHistory = @($history | Select-Object -Last 50)
    $trimmedHistory | ForEach-Object { $_ | ConvertTo-Json -Compress } | Set-Content -Path $historyPath -Encoding utf8
}

function Invoke-TargetScript([string]$file, [switch]$ApplyMode) {
    $captured = @()
    if ($ApplyMode) {
        Write-Host ""
        Write-Host "----- Re-running with -Apply -----" -ForegroundColor Magenta
        & $file -Apply *>&1 | Tee-Object -Variable captured | Out-Host
    } else {
        & $file *>&1 | Tee-Object -Variable captured | Out-Host
    }
    return ($captured -join "`r`n")
}

$currentHash = Get-FileHashHex -path $targetFile
$firstLine = Get-FirstMeaningfulLine -path $targetFile

$history = @(Get-RunHistory)
$priorMatch = $history | Where-Object { $_.hash -eq $currentHash } | Select-Object -Last 1

if ($priorMatch) {
    Write-Host ""
    Write-Host "===== DUPLICATE RUN DETECTED =====" -ForegroundColor Red
    Write-Host "This exact script content was already run before:" -ForegroundColor Yellow
    Write-Host "  Previously run at : $($priorMatch.timestamp)" -ForegroundColor Yellow
    Write-Host "  First line was    : $($priorMatch.firstLine)" -ForegroundColor Yellow
    Write-Host "  Mode              : $($priorMatch.mode)" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Type YES (all caps) to run it anyway, or anything else to cancel"
    if ($response -ne "YES") {
        Write-Host ""
        Write-Host "[CANCELLED] Nothing was run." -ForegroundColor Cyan
        exit 0
    }
    Write-Host ""
    Write-Host "[CONFIRMED] Proceeding with re-run at your explicit request." -ForegroundColor Yellow
}

$dryRunOutput = Invoke-TargetScript -file $targetFile
Add-RunHistoryEntry -hash $currentHash -firstLine $firstLine -fileName $candidate.Name -mode "dry-run"

$finalOutput = $dryRunOutput

if ($dryRunOutput -match [regex]::Escape("[DRY RUN ONLY]")) {
    Write-Host ""
    Write-Host "===== THIS SCRIPT SUPPORTS -Apply =====" -ForegroundColor Magenta
    Write-Host "The dry run above completed with no changes made." -ForegroundColor Yellow
    $applyResponse = Read-Host "Type APPLY (all caps) to run it again now WITH -Apply, or press Enter to stop here"
    if ($applyResponse -eq "APPLY") {
        $applyOutput = Invoke-TargetScript -file $targetFile -ApplyMode
        Add-RunHistoryEntry -hash $currentHash -firstLine $firstLine -fileName $candidate.Name -mode "apply"
        $finalOutput = $dryRunOutput + "`r`n`r`n" + $applyOutput
    } else {
        Write-Host ""
        Write-Host "[STOPPED] No changes were made. Press Ctrl+Alt+R again on the same" -ForegroundColor Cyan
        Write-Host "download whenever you're ready to apply." -ForegroundColor Cyan
    }
}

Set-Content -Path $logPath -Value $finalOutput -Encoding utf8
$finalOutput | Set-Clipboard

Write-Host ""
Write-Host "[COPIED] Full output copied to clipboard - paste directly into chat with Ctrl+V." -ForegroundColor Magenta