# One-time setup: registers the ngrok tunnel and webhook-receiver.cjs as Windows Scheduled
# Tasks that start automatically when you log in and restart automatically if they ever
# crash or get closed - so the Base44 <-> local sync relay survives reboots and no longer
# depends on two terminal windows being kept open manually.
#
# Run this once as the same Windows user who normally uses EnQuote. No admin rights are
# needed - both tasks run as the current user (Interactive logon), not SYSTEM.
#
# Safe to re-run any time (e.g. after moving the repo or updating Node) - existing tasks
# are replaced, not duplicated.
#
# To remove: run uninstall-services.ps1.

$ErrorActionPreference = "Stop"
$repoRoot = "C:\EnQuoteBuild"
$taskFolder = "\EnQuote\"
$userId = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "=== EnQuote Service Setup ===" -ForegroundColor Cyan
Write-Host "Registering tasks under $taskFolder for user $userId`n"

# Stop any manually-started copies first so the new service-managed ones don't collide on
# port 3001 / the ngrok tunnel session.
Write-Host "Stopping any manually-running ngrok / webhook-receiver processes..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name='ngrok.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Stopping ngrok.exe (PID $($_.ProcessId))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*webhook-receiver.cjs*" } | ForEach-Object {
        Write-Host "  Stopping webhook-receiver.cjs (PID $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Seconds 2

$restartSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

function Install-EnQuoteTask {
    param([string]$Name, [string]$ScriptPath, [string]$Description)

    # Launched via run-hidden.vbs (wscript.exe) rather than "powershell.exe -WindowStyle
    # Hidden" directly - that flag is well-known to be unreliable when a task is started
    # by Task Scheduler, and was confirmed here to actually leave a visible console window
    # (webhook-receiver.cjs's own console kept popping up). wscript.exe has no console of
    # its own, so its WScript.Shell.Run(..., 0, ...) reliably suppresses the child window.
    $vbsPath = "$repoRoot\tools\services\run-hidden.vbs"
    $action = New-ScheduledTaskAction -Execute "wscript.exe" `
        -Argument "`"$vbsPath`" `"powershell.exe`" `"-NoProfile`" `"-ExecutionPolicy`" `"Bypass`" `"-File`" `"$ScriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId

    Register-ScheduledTask -TaskName $Name -TaskPath $taskFolder -Action $action -Trigger $trigger `
        -Settings $restartSettings -Principal $principal -Description $Description -Force | Out-Null

    Write-Host "[OK] Registered task: $taskFolder$Name" -ForegroundColor Green
}

Install-EnQuoteTask -Name "ngrok-tunnel" -ScriptPath "$repoRoot\tools\services\run-ngrok-tunnel.ps1" `
    -Description "Keeps the ngrok tunnel (EnQuote <-> Base44 webhook relay) online, auto-restarting on crash/reboot."

Install-EnQuoteTask -Name "webhook-receiver" -ScriptPath "$repoRoot\tools\services\run-webhook-receiver.ps1" `
    -Description "Keeps webhook-receiver.cjs online (receives signed Base44 snapshots), auto-restarting on crash/reboot."

Write-Host "`nStarting both tasks now..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName "ngrok-tunnel" -TaskPath $taskFolder
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName "webhook-receiver" -TaskPath $taskFolder
Start-Sleep -Seconds 3

Write-Host "`n=== Verifying ===" -ForegroundColor Cyan
$ngrokUp = Get-Process ngrok -ErrorAction SilentlyContinue
$receiverUp = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*webhook-receiver.cjs*" }

if ($ngrokUp) { Write-Host "[OK] ngrok.exe running (PID $($ngrokUp.Id))" -ForegroundColor Green }
else { Write-Host "[WARN] ngrok.exe not detected yet - check Task Scheduler > EnQuote folder for errors." -ForegroundColor Yellow }

if ($receiverUp) { Write-Host "[OK] webhook-receiver.cjs running (PID $($receiverUp.ProcessId))" -ForegroundColor Green }
else { Write-Host "[WARN] webhook-receiver.cjs not detected yet - check Task Scheduler > EnQuote folder for errors." -ForegroundColor Yellow }

Write-Host "`nDone. View status any time with:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskPath '$taskFolder' | Get-ScheduledTaskInfo"
