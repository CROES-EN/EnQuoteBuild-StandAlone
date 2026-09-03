# Periodic health check + auto-heal for the local Base44 sync relay (ngrok tunnel +
# webhook-receiver.cjs). Run on a recurring schedule (see install-watchdog.ps1).
#
# This is the REAL crash-recovery mechanism for the relay - Windows Task Scheduler's
# built-in "restart on failure" setting (configured on the ngrok-tunnel / webhook-receiver
# tasks themselves) turned out not to reliably fire when a long-running foreground process
# is killed externally (tested directly: it did not restart on its own). A plain recurring
# trigger that explicitly checks "is it alive?" and calls Start-ScheduledTask if not is
# simple and was confirmed to work reliably.
#
# On each run:
#   1. Restarts ngrok.exe (via its Scheduled Task) if its process isn't running.
#   2. Restarts webhook-receiver.cjs (via its Scheduled Task) if its process isn't running.
#   3. Checks whether the last successful sync is older than a staleness threshold, and
#      if so (or the relay is unreachable even after trying to heal it), raises a Windows
#      toast notification so a real problem doesn't go unnoticed indefinitely.
#   4. Always appends a status line to sync-watchdog.log, regardless of whether the toast
#      succeeds - the log is the authoritative record; the toast is a best-effort nicety.

$ErrorActionPreference = "Continue"
$repoRoot = "C:\EnQuoteBuild"
$logPath = Join-Path $repoRoot "sync-watchdog.log"
$staleThresholdMinutes = 45
$taskFolder = "\EnQuote\"
# The on-disk data file (not the receiver's in-memory /status) is the authoritative source
# for "when did we last actually import something" - /status resets to empty every time
# webhook-receiver.cjs restarts (e.g. after this very watchdog heals it), which would
# otherwise make a genuinely stale sync look falsely "unknown/OK" right after a restart.
function Get-LocalDataFilePath {
    $envFile = Join-Path $repoRoot ".env"
    $dataDir = $null
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^ENQUOTE_LOCAL_DATA_PATH=' } | Select-Object -First 1
        if ($line) { $dataDir = ($line -split '=', 2)[1].Trim() }
    }
    if (-not $dataDir) { $dataDir = Join-Path $env:APPDATA "base44-app" }
    return Join-Path $dataDir "enquote-demo-data-v1.json"
}
# PowerShell's own registered AUMID - lets an unpackaged script raise a real Windows toast
# without needing a Start Menu shortcut or app registration of its own.
$toastAppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
# Avoids spamming a fresh toast every single run while a problem persists.
$toastCooldownMinutes = 30
$toastStateFile = Join-Path $repoRoot ".watchdog-last-toast"

function Write-Log($message) {
    $line = "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $message"
    Write-Host $line
    # Retries briefly on a transient file lock (e.g. antivirus scan, or another instance
    # writing at the same instant) rather than losing the log line outright.
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Add-Content -Path $logPath -Value $line -ErrorAction Stop
            break
        } catch {
            if ($attempt -eq 3) {
                Write-Host "  (log write failed after 3 attempts: $($_.Exception.Message))"
            } else {
                Start-Sleep -Milliseconds 300
            }
        }
    }
    # Keep the log from growing unbounded - trim to the most recent ~1000 lines.
    try {
        $existing = Get-Content -Path $logPath -ErrorAction Stop
        if ($existing.Count -gt 1000) {
            $existing | Select-Object -Last 1000 | Set-Content -Path $logPath -ErrorAction Stop
        }
    } catch {
        # Trimming is best-effort only.
    }
}

function Show-ToastThrottled($title, $message) {
    try {
        $lastToast = if (Test-Path $toastStateFile) { [DateTime]::Parse((Get-Content $toastStateFile -Raw)) } else { [DateTime]::MinValue }
        if (((Get-Date) - $lastToast).TotalMinutes -lt $toastCooldownMinutes) {
            Write-Log "Toast suppressed (cooldown active): $title - $message"
            return
        }

        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $textNodes = $template.GetElementsByTagName("text")
        $textNodes.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
        $textNodes.Item(1).AppendChild($template.CreateTextNode($message)) | Out-Null

        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($toastAppId).Show($toast)
        Get-Date | Out-String | Set-Content -Path $toastStateFile
        Write-Log "Toast shown: $title - $message"
    } catch {
        Write-Log "Toast notification failed (non-fatal, see log for the real status): $($_.Exception.Message)"
    }
}

# --- 1. ngrok ---
$ngrokRunning = Get-Process ngrok -ErrorAction SilentlyContinue
if (-not $ngrokRunning) {
    Write-Log "ngrok.exe is NOT running - restarting via Scheduled Task..."
    Start-ScheduledTask -TaskName "ngrok-tunnel" -TaskPath $taskFolder
    Start-Sleep -Seconds 5
}

# --- 2. webhook-receiver ---
$receiverRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*webhook-receiver.cjs*" }
if (-not $receiverRunning) {
    Write-Log "webhook-receiver.cjs is NOT running - restarting via Scheduled Task..."
    Start-ScheduledTask -TaskName "webhook-receiver" -TaskPath $taskFolder
    Start-Sleep -Seconds 5
}

# --- 3. Health + staleness check (also catches the case where processes exist but are wedged) ---
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/health" -TimeoutSec 8

    if (-not $health.ok) {
        Write-Log "webhook-receiver /health responded but reported not-ok."
        Show-ToastThrottled "EnQuote Sync Problem" "The local sync relay is unhealthy - check sync-watchdog.log."
    } else {
        $dataFile = Get-LocalDataFilePath
        $lastImportedAt = $null
        if (Test-Path $dataFile) {
            try {
                $lastImportedAt = (Get-Content $dataFile -Raw | ConvertFrom-Json).meta.last_imported_at
            } catch {
                Write-Log "Could not parse local data file at $dataFile - $($_.Exception.Message)"
            }
        }

        if ($lastImportedAt) {
            $ageMinutes = ((Get-Date).ToUniversalTime() - [DateTime]::Parse($lastImportedAt).ToUniversalTime()).TotalMinutes
            if ($ageMinutes -gt $staleThresholdMinutes) {
                Write-Log "STALE: last successful sync was $([math]::Round($ageMinutes)) minute(s) ago (threshold $staleThresholdMinutes)."
                Show-ToastThrottled "EnQuote Sync Stale" "No successful Base44 sync in $([math]::Round($ageMinutes)) minutes. Check the app and network."
            } else {
                Write-Log "OK: relay healthy, last successful sync $([math]::Round($ageMinutes)) minute(s) ago."
            }
        } else {
            Write-Log "OK: relay healthy, no import recorded yet at $dataFile."
        }
    }
} catch {
    Write-Log "Could not reach webhook-receiver /health or /status: $($_.Exception.Message)"
    Show-ToastThrottled "EnQuote Sync Problem" "Could not reach the local sync relay at all - check sync-watchdog.log."
}
