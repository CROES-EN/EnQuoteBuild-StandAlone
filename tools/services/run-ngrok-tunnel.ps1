# Runs the ngrok tunnel (EnQuote <-> Base44 webhook relay) in the FOREGROUND, blocking
# until ngrok exits for any reason. Meant to be launched by the "EnQuote\ngrok-tunnel"
# Scheduled Task (see install-services.ps1) - Task Scheduler only knows to apply its
# "restart on failure" policy when the process IT launched actually exits, so this script
# must not return until ngrok itself does.
#
# Reuses the exact same domain-binding setup already in place: the reserved
# "refold-frisk-scarce.ngrok-free.dev" hostname comes from this ngrok account's Cloud
# Endpoint configuration (in the ngrok dashboard), not a command-line flag - any tunnel
# this authenticated agent opens on port 3001 is automatically bound to it.

$ngrokExe = Join-Path $env:USERPROFILE "ngrok.exe"
$logPath = "C:\EnQuoteBuild\ngrok.log"

if (-not (Test-Path $ngrokExe)) {
    Write-Error "ngrok.exe not found at $ngrokExe - update this script if ngrok was installed elsewhere."
    exit 1
}

& $ngrokExe http 3001 --log=stdout --log-format=logfmt --log="$logPath"
exit $LASTEXITCODE
