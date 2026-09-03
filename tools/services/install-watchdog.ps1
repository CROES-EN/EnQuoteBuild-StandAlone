# One-time setup: registers sync-watchdog.ps1 as a Windows Scheduled Task that runs every
# few minutes, for as long as you're logged in, to auto-heal the ngrok/webhook-receiver
# relay if either process ever dies and to alert (Windows toast + sync-watchdog.log) if the
# last successful Base44 sync goes stale despite that.
#
# Run this once, after install-services.ps1. No admin rights required. Safe to re-run.
#
# To remove: run uninstall-services.ps1 (removes this task too).

$ErrorActionPreference = "Stop"
$repoRoot = "C:\EnQuoteBuild"
$taskFolder = "\EnQuote\"
$taskName = "sync-watchdog"
$userId = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "=== EnQuote Sync Watchdog Setup ===" -ForegroundColor Cyan

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
# Launched via run-hidden.vbs (wscript.exe) rather than "powershell.exe -WindowStyle
# Hidden" directly - see install-services.ps1 for why (that flag was confirmed unreliable
# and left a visible console window popping up every few minutes).
$vbsPath = "$repoRoot\tools\services\run-hidden.vbs"
$watchdogScript = "$repoRoot\tools\services\sync-watchdog.ps1"
$action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument "`"$vbsPath`" `"powershell.exe`" `"-NoProfile`" `"-ExecutionPolicy`" `"Bypass`" `"-File`" `"$watchdogScript`""

# Fires once at logon, then repeats every 3 minutes for up to 10 years (Task Scheduler's
# repetition-within-a-trigger mechanism, distinct from - and much more reliable for this
# purpose than - the "restart on failure" setting used on the relay tasks themselves).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 3) -RepetitionDuration (New-TimeSpan -Days 3650)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

Register-ScheduledTask -TaskName $taskName -TaskPath $taskFolder -Action $action `
    -Trigger @($trigger, $logonTrigger) -Settings $settings -Principal $principal `
    -Description "Checks every few minutes that the ngrok tunnel and webhook-receiver.cjs are alive and the last Base44 sync isn't stale; auto-restarts and alerts as needed." `
    -Force | Out-Null

Write-Host "[OK] Registered task: $taskFolder$taskName (runs every 3 minutes)" -ForegroundColor Green

Write-Host "`nRunning it once now to verify..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName -TaskPath $taskFolder
Start-Sleep -Seconds 5
Write-Host "`nRecent log entries:" -ForegroundColor Cyan
if (Test-Path "$repoRoot\sync-watchdog.log") {
    Get-Content "$repoRoot\sync-watchdog.log" -Tail 5
} else {
    Write-Host "[WARN] Log file not created yet - check Task Scheduler > EnQuote folder for errors." -ForegroundColor Yellow
}

Write-Host "`nDone. View status any time with:" -ForegroundColor Cyan
Write-Host "  Get-Content C:\EnQuoteBuild\sync-watchdog.log -Tail 20"
