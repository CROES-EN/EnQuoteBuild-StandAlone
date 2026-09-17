Write-Host "===== Running all EnQuote data-layer tests =====" -ForegroundColor Cyan
$testsDir = "C:\EnQuoteBuild\_tests"
$failed = $false
Get-ChildItem $testsDir -Filter "test-*.mjs" | ForEach-Object {
    Write-Host ""
    Write-Host "--- $($_.Name) ---" -ForegroundColor Yellow
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { $failed = $true }
}
Write-Host ""
if ($failed) {
    Write-Host "===== ONE OR MORE TEST FILES FAILED =====" -ForegroundColor Red
    exit 1
} else {
    Write-Host "===== ALL TESTS PASSED =====" -ForegroundColor Green
}
