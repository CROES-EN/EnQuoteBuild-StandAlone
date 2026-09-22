# EnQuote — Remote Shared Sync Setup

This guide explains how to connect a teammate's EnQuote installation to the host's
shared sync connection, so their "Refresh App" button pulls live data instead of
relying only on background sync.

## Prerequisites

- The teammate's EnQuote must be on **v1.0.7 or later** (check the version number
  shown in the app's left sidebar).
- The **host machine** (the one running the shared sync connection) must have
  `webhook-receiver.cjs` running, and its tunnel URL must be currently active.
- You'll need two values from the host: the current **sync URL** and the **shared
  secret**.

---

## Windows Setup

### Step 1 — Find the real local data folder

The folder name used by EnQuote can vary between installs, so check both known
candidates and see which one has a recent modification date:

```powershell
Get-ChildItem "$env:APPDATA\base44-app\enquote-demo-data-v1.json", "$env:APPDATA\EnQuote Demo\enquote-demo-data-v1.json" -ErrorAction SilentlyContinue | Select-Object FullName, LastWriteTime
```

Whichever file shows a recent `LastWriteTime` is the one actually in use — use that
same folder name in the steps below.

### Step 2 — Create the config file

Replace `<FOLDER_NAME>`, `<SYNC_URL>`, and `<SHARED_SECRET>` with the real values,
then run:

```powershell
$json = '{ "url": "https://refold-frisk-scarce.ngrok-free.dev", "secret": "afQ2E1gxnPZzN8ARf7S4CF9TErjWU4dt4iXECvoSUi0=" }'
$path = "$env:APPDATA\<FOLDER_NAME>\remote-sync-config.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $json, $utf8NoBom)
```

### Step 3 — Verify

```powershell
Get-Content $path
```

Confirm the URL and secret look correct.

### Step 4 — Restart and test

Fully quit EnQuote and reopen it, then click **"Refresh App."**

---

## MacOS Setup ## 

### Step 1 — Find the real local data folder

```bash
ls -la ~/Library/Application\ Support/base44-app/enquote-demo-data-v1.json 2>/dev/null
ls -la ~/Library/Application\ Support/EnQuote\ Demo/enquote-demo-data-v1.json 2>/dev/null
```

Whichever path actually returns a file (with a recent modified date) is the correct
folder to use below.

### Step 2 — Create the config file

Replace `<FOLDER_NAME>`, `<SYNC_URL>`, and `<SHARED_SECRET>`:

```bash
cat > ~/Library/Application\ Support/<FOLDER_NAME>/remote-sync-config.json << 'EOF'
{ "url": "<SYNC_URL>", "secret": "<SHARED_SECRET>" }
EOF
```

### Step 3 — Verify

```bash
cat ~/Library/Application\ Support/<FOLDER_NAME>/remote-sync-config.json
```

### Step 4 — Restart and test

Fully quit EnQuote (**Cmd+Q** — not just closing the window) and reopen it, then click
**"Refresh App."**

---

## Host-side checklist (before anyone else tests)

On the host machine:

```powershell
cd <path-to-EnQuoteBuild>
node webhook-receiver.cjs
```

Leave this terminal running. Confirm it's healthy:

```powershell
Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing
```

## Updating the sync URL later

If the host's tunnel URL ever changes (e.g. after a free-tier ngrok restart), every
teammate using remote sync needs their `remote-sync-config.json`'s `"url"` value
updated to match. Just repeat Step 2 above with the new URL — no reinstall or app
update required.

## Troubleshooting

- **"Refresh App" doesn't seem to do anything new:** confirm the config file is in the
  *correct* folder (Step 1) — a file in the wrong folder is silently ignored.
- **Still not working:** confirm the host's `webhook-receiver.cjs` is actually running
  and its tunnel is live; the shared secret must match exactly on both ends.
