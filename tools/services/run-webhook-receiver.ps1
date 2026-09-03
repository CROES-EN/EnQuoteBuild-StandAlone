# Runs webhook-receiver.cjs in the FOREGROUND, blocking until it exits for any reason.
# Meant to be launched by the "EnQuote\webhook-receiver" Scheduled Task (see
# install-services.ps1) - Task Scheduler only knows to apply its "restart on failure"
# policy when the process IT launched actually exits, so this script must not return
# until node itself does.

$nodeDir = "$env:USERPROFILE\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"
$repoRoot = "C:\EnQuoteBuild"

if (-not (Test-Path $nodeExe)) {
    Write-Error "node.exe not found at $nodeExe - update this script if Node was installed elsewhere."
    exit 1
}

Set-Location $repoRoot
& $nodeExe (Join-Path $repoRoot "webhook-receiver.cjs")
exit $LASTEXITCODE
