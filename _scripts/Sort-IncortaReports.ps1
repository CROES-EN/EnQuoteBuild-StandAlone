$watchFolder       = "C:\Users\croeschberger\OneDrive - Enphase Energy\O&M Excel Spreadsheets\Incorta"
$callMetricsFolder = "C:\Users\croeschberger\OneDrive - Enphase Energy\O&M Excel Spreadsheets\Call Metrics"
$emailCasesFolder  = "C:\Users\croeschberger\OneDrive - Enphase Energy\O&M Excel Spreadsheets\Email Cases"
$logFolder         = "C:\EnQuoteBuild\_script-output"
$logFile           = Join-Path $logFolder "incorta-autosort.log"

foreach ($folder in @($callMetricsFolder, $emailCasesFolder, $logFolder)) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
}

function Write-Log([string]$message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp | $message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

if (-not (Test-Path $watchFolder)) {
    Write-Log "[SKIP] Watch folder does not exist yet: $watchFolder"
    exit 0
}

function Test-FileIsStable([System.IO.FileInfo]$file) {
    try {
        $sizeBefore = $file.Length
        Start-Sleep -Milliseconds 2000
        $file.Refresh()
        $sizeAfter = $file.Length
        if ($sizeBefore -ne $sizeAfter) { return $false }
        try {
            $stream = [System.IO.File]::Open($file.FullName, 'Open', 'Read', 'None')
            $stream.Close()
            return $true
        } catch {
            return $false
        }
    } catch {
        return $false
    }
}

function Get-SafeDestinationPath([string]$destFolder, [string]$fileName) {
    $candidatePath = Join-Path $destFolder $fileName
    if (-not (Test-Path $candidatePath)) { return $candidatePath }
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
    $extension = [System.IO.Path]::GetExtension($fileName)
    $counter = 2
    do {
        $candidatePath = Join-Path $destFolder "$baseName ($counter)$extension"
        $counter++
    } while (Test-Path $candidatePath)
    return $candidatePath
}

$files = Get-ChildItem -Path $watchFolder -File -Force -ErrorAction SilentlyContinue
$movedCount = 0
$skippedUnstableCount = 0
$unmatchedCount = 0

foreach ($file in $files) {
    $destFolder = $null
    if ($file.Name -like "EODB Dashboard*") {
        $destFolder = $callMetricsFolder
    } elseif ($file.Name -like "Pronto Metrics Dashboard*") {
        $destFolder = $emailCasesFolder
    } else {
        $unmatchedCount++
        continue
    }

    if (-not (Test-FileIsStable $file)) {
        $skippedUnstableCount++
        Write-Log "[SKIP-UNSTABLE] $($file.Name) - still being written/synced, will retry next run"
        continue
    }

    $destPath = Get-SafeDestinationPath -destFolder $destFolder -fileName $file.Name
    try {
        Move-Item -Path $file.FullName -Destination $destPath -Force
        $movedCount++
        Write-Log "[MOVED] $($file.Name) -> $destFolder"
    } catch {
        Write-Log "[ERROR] Failed to move $($file.Name): $($_.Exception.Message)"
    }
}

Write-Log "[RUN COMPLETE] Moved=$movedCount, SkippedUnstable=$skippedUnstableCount, Unmatched=$unmatchedCount, TotalScanned=$($files.Count)"
