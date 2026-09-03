# ENquote Webhook Integration - Quick Start

## Recommended: Run the Relay as Auto-Restarting Services (One-Time Setup)

Instead of manually keeping a terminal open for the webhook receiver (and another for
ngrok), register both as Windows Scheduled Tasks that start at logon and are actively
health-checked/auto-healed every few minutes:

```powershell
cd C:\EnQuoteBuild
powershell -ExecutionPolicy Bypass -File .\tools\services\install-services.ps1
powershell -ExecutionPolicy Bypass -File .\tools\services\install-watchdog.ps1
```

This replaces the manual "Terminal 1" step below. See
[`tools/services/README.md`](tools/services/README.md) for details, health-check commands,
and how to uninstall. You still start the app itself the normal way (Terminal 2 below, or
your usual Launch-EnQuote-*.cmd shortcut).

## TL;DR - Three Commands to Run (manual alternative)

### Terminal 1: Start Webhook Receiver
```powershell
$env:Path = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64;$env:Path"
cd C:\EnQuoteBuild
node .\webhook-receiver.cjs
```

### Terminal 2: Start the App
```powershell
$env:Path = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64;$env:Path"
cd C:\EnQuoteBuild
npm run build
npx electron .
```

Note: The `.env.local` file is already configured with `VITE_DATA_SOURCE=local`, so no need to set it manually.

### Terminal 3: Send Test Webhook (Optional)
```powershell
$env:Path = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64;$env:Path"
cd C:\EnQuoteBuild
# Create a test payload and POST it with HMAC signature
# See WEBHOOK_SETUP_GUIDE.md for full details
```

---

## What It Does

1. **Webhook Receiver** (port 3001)
   - Listens for Base44 snapshots
   - Validates HMAC-SHA256 signature
   - Caches imports every 15 minutes (prevents constant reloads)
   - Writes data to local app file

2. **Electron App**
   - Starts with demo seed quotes
   - Watches local data file
   - Auto-reloads when webhook imports new data
   - Displays cached quotes (no constant refreshing)

3. **15-Minute Throttle**
   - First webhook: imports data
   - Next 14:59 minutes: returns cached data
   - After 15 min: next webhook imports fresh data
   - Prevents webhook spam from reloading the UI constantly

---

## Expected Flow

```
Base44 sends signed snapshot → Webhook receiver validates & throttles → 
Data file updated → App auto-reloads → Dashboard shows new quotes
```

---

## Debugging

### Check if webhook receiver is working
```powershell
curl -X POST http://localhost:3001/api/base44/webhook -H "Content-Type: application/json" -d '{"test":"data"}'
```

### View latest webhook events
```powershell
Get-Content C:\EnQuoteBuild\webhook-events.jsonl -Tail 5
```

### Check what data was imported
```powershell
$data = Get-Content "C:\Users\$env:USERNAME\AppData\Roaming\base44-app\enquote-demo-data-v1.json" | ConvertFrom-Json
$data.quotes | Select-Object id, title, status | Format-Table
```

---

## Configuration

**Shared Secret** (in `.env`):
```
ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET=afQ2E1gxnPZzN8ARf7S4CF9TErjWU4dt4iXECvoSUi0=
```

**Base44 Configuration**:
- Endpoint: `https://refold-frisk-scarce.ngrok-free.dev/api/base44/webhook`
- Secret: (same as above)
- Header: `X-ENQuote-Signature: sha256=<hex>`
- Payload: `schema_version: enquote-local-sync-v1` with snapshot.entities structure
- Schedule: 15-20 minutes

---

## Files Created/Modified

- ✅ `webhook-receiver.cjs` - Local Node.js server that receives/validates webhooks
- ✅ `electron/repository.cjs` - Added import logic & throttle metadata
- ✅ `electron/main.cjs` - Added file watcher for auto-reload
- ✅ `.env` - Stores the shared HMAC secret
- ✅ `WEBHOOK_SETUP_GUIDE.md` - Full documentation

---

## Common Issues

| Issue | Solution |
|-------|----------|
| Webhook returns 401 | Check secret in `.env` matches Base44 config |
| App doesn't reload | Verify file watcher is running (check Electron console) |
| Import shows 0 quotes | Check webhook-events.jsonl for errors |
| ngrok URL changed | Update Base44 configuration with new URL |
| App crashes on login | Close the sign-in window to use local demo mode |

---

For complete details, see `WEBHOOK_SETUP_GUIDE.md`
