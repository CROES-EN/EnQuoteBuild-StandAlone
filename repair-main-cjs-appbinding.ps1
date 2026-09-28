<#
  repair-main-cjs-appbinding.ps1

  Fixes: destructuring app.on/app.quit/app.whenReady/app.getPath/app.getVersion directly
  off require("electron") strips their "this" binding to the app object, causing:
    TypeError: Cannot read properties of undefined (reading '_events')
  at any app.on(...) call (electron's app extends Node's EventEmitter, which needs
  "this" to be the real app instance).

  Fix: import "app" itself, then re-create getPath/getVersion/on/quit/whenReady as
  BOUND versions of the real app methods. Every existing call site in the file
  (getPath(...), on(...), quit(), whenReady(), getVersion()) keeps working exactly as
  written - only the top of the file changes.

  Always backs up first. Safe to re-run.
#>

$ErrorActionPreference = "Stop"
$targetFile = Join-Path (Get-Location) "electron\main.cjs"

Write-Host "==============================================="
Write-Host " main.cjs app-binding Repair"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at: $targetFile" -ForegroundColor Red
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"
Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created: $backupFile"
Write-Host ""

$content = Get-Content -Path $targetFile -Raw -Encoding UTF8
$originalContent = $content

$oldRequirePattern = 'const \{ app: \{getPath, getVersion, isPackaged, on, quit, whenReady\}, BrowserWindow, ipcMain, shell, dialog \} = require\("electron"\);'

$newRequireBlock = @'
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
// FIX: destructuring these directly off app (e.g. "const { on } = app") strips their
// "this" binding back to the real app instance, which crashes as soon as they're
// called (app extends EventEmitter internally, and needs "this" to be app itself).
// Re-creating them here as explicitly bound functions keeps every existing call site
// below (getPath(...), on(...), quit(), whenReady(), getVersion()) working unchanged.
const getPath = app.getPath.bind(app);
const getVersion = app.getVersion.bind(app);
const isPackaged = app.isPackaged;
const on = app.on.bind(app);
const quit = app.quit.bind(app);
const whenReady = app.whenReady.bind(app);
'@

if ($content -match [regex]::Escape($oldRequirePattern) -or $content.Contains('const { app: {getPath, getVersion, isPackaged, on, quit, whenReady}, BrowserWindow, ipcMain, shell, dialog } = require("electron");')) {
    $content = $content.Replace(
        'const { app: {getPath, getVersion, isPackaged, on, quit, whenReady}, BrowserWindow, ipcMain, shell, dialog } = require("electron");',
        $newRequireBlock
    )
    Write-Host "Replaced the broken destructuring require with bound versions." -ForegroundColor Green
} else {
    Write-Host "Exact require line not found - it may already be fixed, or wording differs slightly." -ForegroundColor Yellow
}

if ($content -ne $originalContent) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)
    Write-Host "SUCCESS - file saved." -ForegroundColor Green
} else {
    Write-Host "No changes made."
}

Write-Host ""
Write-Host "Verifying syntax with 'node --check'..."
$checkResult = & node --check $targetFile 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Syntax check PASSED." -ForegroundColor Green
} else {
    Write-Host "Syntax check FAILED:" -ForegroundColor Red
    Write-Host $checkResult
    Write-Host "Restore backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
