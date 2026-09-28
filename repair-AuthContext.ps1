<#
  repair-AuthContext.ps1

  What this does:
    1. Finds src\lib\AuthContext.jsx relative to where you run this script
    2. Makes a timestamped backup copy first (safety net, same pattern as your other scripts)
    3. Fixes two known issues:
         a) The eslint-disable comment inside useEffect() that was wrapped in a
            JSDoc-style /** */ block instead of a plain // line, which means
            ESLint never actually reads it as a real directive.
         b) A corrupted "em dash" character (mojibake) inside a comment string.
            (This version uses Unicode escape codes instead of typing the actual
            special characters, so the script itself can't get corrupted again
            when downloaded/copied - same class of bug as the bullet-point issue
            fixed earlier.)
    4. Prints a summary of what was changed.

  How to run it:
    Open a terminal in your EnQuoteBuild-StandAlone project root, then run:
        .\repair-AuthContext.ps1

  Safe to run more than once - if the patterns are already fixed, it will just
  report "not found / already fixed" for that item instead of breaking anything.
#>

$ErrorActionPreference = "Stop"

$targetFile = Join-Path (Get-Location) "src\lib\AuthContext.jsx"

Write-Host "==============================================="
Write-Host " AuthContext.jsx Repair Script"
Write-Host "==============================================="

if (-not (Test-Path $targetFile)) {
    Write-Host "ERROR: Could not find file at:" -ForegroundColor Red
    Write-Host "  $targetFile"
    Write-Host ""
    Write-Host "Make sure you run this script from your project root"
    Write-Host "(the folder that contains package.json and the 'src' folder)."
    exit 1
}

Write-Host "Found target file:"
Write-Host "  $targetFile"
Write-Host ""

# --- Step 1: Backup -----------------------------------------------------

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$targetFile.bak-$timestamp"

Copy-Item -Path $targetFile -Destination $backupFile -Force
Write-Host "Backup created:"
Write-Host "  $backupFile"
Write-Host ""

# --- Step 2: Load content -------------------------------------------------

$content = Get-Content -Path $targetFile -Raw -Encoding UTF8

$originalContent = $content
$changesMade = @()

# --- Fix 1: JSDoc-wrapped eslint-disable comment --------------------------
# Before:
#   /**
#    * eslint-disable-next-line react-hooks/exhaustive-deps
#    */
# After:
#   // eslint-disable-next-line react-hooks/exhaustive-deps

$badEslintPattern = '(?s)/\*\*\s*\*\s*eslint-disable-next-line react-hooks/exhaustive-deps\s*\*/'
if ($content -match $badEslintPattern) {
    $content = [regex]::Replace(
        $content,
        $badEslintPattern,
        '// eslint-disable-next-line react-hooks/exhaustive-deps'
    )
    $changesMade += "Fixed malformed eslint-disable comment (JSDoc block -> single-line //)"
} else {
    Write-Host "Fix 1 (eslint-disable comment): pattern not found - may already be fixed." -ForegroundColor Yellow
}

# --- Fix 2: Corrupted em dash (mojibake) in comment -----------------------
# Before: fall through <mojibake bytes> user will be prompted to log in
# After:  fall through - user will be prompted to log in
#
# IMPORTANT: Built using [char] codes instead of typing the actual mojibake
# bytes directly in this file. Typing/copy-pasting the corrupted bytes
# themselves is exactly what caused this to break the first time - encoding
# gets mangled again on every copy. Building the search pattern from character
# codes avoids that entirely.

# The mojibake sequence is UTF-8 bytes for an em dash (E2 80 94), each byte then
# individually misread as Windows-1252. Build that exact broken text here:
$mojibakeDash = [string]([char]0x00C3) + [string]([char]0x00A2) + `
                [string]([char]0x00E2) + [string]([char]0x0080) + `
                [string]([char]0x009D)

$mojibakePattern = "fall through\s*" + [regex]::Escape($mojibakeDash) + "\s*user will be prompted"

if ($content -match $mojibakePattern) {
    $content = [regex]::Replace(
        $content,
        $mojibakePattern,
        'fall through - user will be prompted'
    )
    $changesMade += "Fixed corrupted em dash character in comment"
} else {
    # Fallback: just look for "fall through" followed by any non-ASCII junk
    # before "user will be prompted", in case the exact byte sequence differs
    # slightly from machine to machine.
    $looserPattern = 'fall through\s*[^\x00-\x7F]+\s*user will be prompted'
    if ($content -match $looserPattern) {
        $content = [regex]::Replace(
            $content,
            $looserPattern,
            'fall through - user will be prompted'
        )
        $changesMade += "Fixed corrupted dash character in comment (loose match)"
    } else {
        Write-Host "Fix 2 (mojibake dash): pattern not found - may already be fixed." -ForegroundColor Yellow
    }
}

# --- Step 3: Save if anything changed -------------------------------------

if ($content -ne $originalContent) {
    # Write back out as UTF-8 WITHOUT BOM (BOM caused a real bug earlier tonight)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($targetFile, $content, $utf8NoBom)

    Write-Host ""
    Write-Host "SUCCESS - file updated:" -ForegroundColor Green
    foreach ($change in $changesMade) {
        Write-Host "  - $change"
    }
    Write-Host ""
    Write-Host "If anything looks wrong, restore the backup with:"
    Write-Host "  Copy-Item `"$backupFile`" `"$targetFile`" -Force"
} else {
    Write-Host ""
    Write-Host "No changes were made - file already matches the expected fixed state." -ForegroundColor Cyan
}

Write-Host ""
Write-Host "==============================================="
Write-Host " Done"
Write-Host "==============================================="
