# Removes the ngrok-tunnel / webhook-receiver Scheduled Tasks created by
# install-services.ps1, and stops any currently-running instances they started. Use this
# to fully revert to manually running things in a terminal (see QUICK_START.md), or before
# re-running install-services.ps1 from a clean slate.

$taskFolder = "\EnQuote\"

foreach ($name in @("ngrok-tunnel", "webhook-receiver", "sync-watchdog")) {
    $task = Get-ScheduledTask -TaskName $name -TaskPath $taskFolder -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $name -TaskPath $taskFolder -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $name -TaskPath $taskFolder -Confirm:$false
        Write-Host "[OK] Removed task: $taskFolder$name" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] Task not found: $taskFolder$name" -ForegroundColor Yellow
    }
}

Write-Host "`nStopping any still-running processes..." -ForegroundColor Yellow
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*webhook-receiver.cjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Done." -ForegroundColor Cyan
