param(
    [string]$ProjectPath = "."
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path $ProjectPath).Path
$packagePath = Join-Path $project "package.json"
$backupPath = Join-Path $project "package.json.before-copilot-fixes.bak"

if (-not (Test-Path $packagePath)) {
    throw "package.json was not found at: $packagePath"
}

Copy-Item $packagePath $backupPath -Force

try {
    $pkg = Get-Content $packagePath -Raw | ConvertFrom-Json
} catch {
    throw "package.json is not valid JSON. Restore from $backupPath and correct the JSON syntax first. Details: $($_.Exception.Message)"
}

# Application metadata requested by electron-builder.
$pkg | Add-Member -NotePropertyName description -NotePropertyValue "Local EnQuote desktop proof of concept for solar O&M quote workflows" -Force
$pkg | Add-Member -NotePropertyName author -NotePropertyValue "Enphase Energy" -Force

# Keep the current proof-of-concept version unless it has already been advanced.
if (-not $pkg.version -or $pkg.version -eq "0.0.0") {
    $pkg.version = "0.1.0"
}

# Ensure the existing Electron build configuration has a predictable Windows artifact name.
if (-not $pkg.build) {
    $pkg | Add-Member -NotePropertyName build -NotePropertyValue ([pscustomobject]@{}) -Force
}
$pkg.build | Add-Member -NotePropertyName artifactName -NotePropertyValue 'EnQuote-Demo-Setup-${version}.${ext}' -Force

# Use an approved local icon only when one exists. This does not download or invent a company icon.
$iconPath = Join-Path $project "build\icon.ico"
if (Test-Path $iconPath) {
    if (-not $pkg.build.win) {
        $pkg.build | Add-Member -NotePropertyName win -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $pkg.build.win | Add-Member -NotePropertyName icon -NotePropertyValue "build/icon.ico" -Force
    Write-Host "Configured approved local icon: build/icon.ico" -ForegroundColor Green
} else {
    Write-Host "No build/icon.ico found. The default Electron icon will remain until an approved icon is added." -ForegroundColor Yellow
}

# Write valid UTF-8 JSON.
$json = $pkg | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($packagePath, $json, [System.Text.UTF8Encoding]::new($false))

# Validate the resulting JSON immediately.
Get-Content $packagePath -Raw | ConvertFrom-Json | Out-Null

Write-Host "Updated package.json successfully." -ForegroundColor Green
Write-Host "Backup: $backupPath"
Write-Host "Next commands:"
Write-Host "  npm.cmd run build"
Write-Host "  npm.cmd run desktop:installer"
