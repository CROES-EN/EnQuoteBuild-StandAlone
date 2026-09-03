# EnQuote Relay Health Check
# Checks: ngrok process, webhook-receiver process, and local /status endpoint.
# Skips the public HTTPS URL test by default (Zscaler blocks ngrok-free.dev on
# this network) - use -TestPublicUrl to attempt it anyway and see the raw error.

param(
    [string]$NgrokUrl = "https://refold-frisk-scarce.ngrok-free.dev",
    [switch]$TestPublicUrl
)

function Write-Check($label, $ok, $detail = "") {
    $mark = if ($ok) { "[OK]" } else { "[FAIL]" }
    $color = if ($ok) { "Green" } else { "Red" }
    Write-Host "$mark $label" -ForegroundColor $color
    if ($detail) { Write-Host "      $detail" -ForegroundColor Gray }
}

Write-Host "`n=== EnQuote Relay Health Check ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date)`n"

# 1. ngrok process
$ngrokProc = Get-Process ngrok -ErrorAction SilentlyContinue
if ($ngrokProc) {
    Write-Check "ngrok process running" $true "PID $($ngrokProc.Id), CPU $($ngrokProc.CPU)s"
} else {
    Write-Check "ngrok process running" $false "No ngrok.exe process found - tunnel is DOWN. Start it before continuing."
}

# 2. webhook-receiver process
$receiverProc = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%webhook-receiver%'" -ErrorAction SilentlyContinue
if ($receiverProc) {
    Write-Check "webhook-receiver process running" $true "PID $($receiverProc.ProcessId)"
} else {
    Write-Check "webhook-receiver process running" $false "No node process running webhook-receiver.cjs - restart it: node webhook-receiver.cjs"
}

# 3. Local /status endpoint (the real source of truth - bypasses Zscaler entirely)
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:3001/status" -UseBasicParsing -TimeoutSec 5
    $json = $resp.Content | ConvertFrom-Json
    if ($json.ok) {
        $last = $json.lastAttempt
        Write-Check "Local receiver /status" $true (
            "ok=$($last.ok), reason=$($last.reason), quotes=$($last.storedQuoteCount), " +
            "products=$($last.storedProductCount), lastAttempt=$($last.startedAt)"
        )
    } else {
        Write-Check "Local receiver /status" $false "Endpoint responded but reported ok:false - check receiver logs."
    }
} catch {
    Write-Check "Local receiver /status" $false "Could not reach http://localhost:3001/status - $($_.Exception.Message)"
}

# 4. Optional: public URL test (expect Zscaler block on this network unless -TestPublicUrl)
if ($TestPublicUrl) {
    try {
        $pubResp = Invoke-WebRequest -Uri "$NgrokUrl/status" -UseBasicParsing -TimeoutSec 8
        Write-Check "Public ngrok URL reachable" $true "Status $($pubResp.StatusCode)"
    } catch {
        Write-Check "Public ngrok URL reachable" $false (
            "Blocked or unreachable from this machine (likely Zscaler corporate proxy). " +
            "This does NOT necessarily mean Base44 can't reach it - Base44's servers aren't " +
            "behind your company's network policy. Check ngrok dashboard 'Recent Traffic' for " +
            "real 200 responses from Base44 instead."
        )
    }
} else {
    Write-Host "[SKIP] Public ngrok URL test (use -TestPublicUrl to attempt; likely blocked by Zscaler on this network)" -ForegroundColor Yellow
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Tip: for the definitive 'is Base44 reaching me' check, open the ngrok dashboard" -ForegroundColor Gray
Write-Host "and look at Recent Traffic for fresh 200 responses on POST /api/base44/webhook." -ForegroundColor Gray
