# Update-EnvLocal.ps1
# Run this from your EnQuote project root:
#   C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\EnQuote
#
# Ensures .env.local has VITE_BASE44_APP_ID pointing at the sandbox app
# (EnQuote-StandAlone, 6a91e7bce36dd777fa88cf04). Adds it if missing,
# or updates it if it already exists but points somewhere else.
# Leaves all other lines in .env.local untouched.

$envPath = ".\.env.local"
$sandboxAppId = "6a91e7bce36dd777fa88cf04"
$varName = "VITE_BASE44_APP_ID"

if (-not (Test-Path $envPath)) {
    Write-Host "No .env.local found — creating a new one." -ForegroundColor Yellow
    New-Item -Path $envPath -ItemType File | Out-Null
}

# Back up first
$backupPath = ".\.env.local.bak"
Copy-Item -Path $envPath -Destination $backupPath -Force
Write-Host "Backed up existing .env.local to $backupPath" -ForegroundColor Cyan

$lines = Get-Content -Path $envPath
$found = $false
$newLines = foreach ($line in $lines) {
    if ($line -match "^\s*$varName\s*=") {
        $found = $true
        "$varName=$sandboxAppId"
    } else {
        $line
    }
}

if (-not $found) {
    $newLines += "$varName=$sandboxAppId"
    Write-Host "Added $varName=$sandboxAppId to .env.local" -ForegroundColor Green
} else {
    Write-Host "Updated existing $varName to point to sandbox ($sandboxAppId)" -ForegroundColor Green
}

Set-Content -Path $envPath -Value $newLines -Encoding UTF8

Write-Host ""
Write-Host "Current .env.local contents:" -ForegroundColor Cyan
Get-Content -Path $envPath

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart your dev server (Ctrl+C, then re-run npm run dev) so Vite picks up the change"
Write-Host "2. In the browser console on localhost:5173, run: localStorage.removeItem('base44_app_id')"
Write-Host "3. Reload localhost:5173 and confirm API calls now use 6a91e7bce36dd777fa88cf04"
