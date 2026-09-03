# ENquote Local-First Webhook Integration - Complete Setup & Usage Guide

## Overview

The ENquote desktop app now implements a **local-first architecture** with secure HMAC-validated webhook integration for Base44 data. The app:

1. **Runs locally** with demo seed data by default (safe for development)
2. **Receives Base44 snapshots** via signed HMAC-SHA256 webhooks on a 15-20 minute schedule
3. **Caches imported data** locally so the UI doesn't reload on every refresh
4. **Auto-reloads** the dashboard when new data arrives from the webhook

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Base44 (External)                                       │
│ - Sends signed snapshots every 15-20 minutes            │
│ - Uses ngrok tunnel or direct HTTPS endpoint            │
└────────────────────┬────────────────────────────────────┘
                     │ HMAC-SHA256 signed POST
                     ▼
        ┌────────────────────────────────┐
        │ ngrok Tunnel (Public URL)      │
        │ https://refold-frisk-scarce... │
        └────────┬─────────────────────┘
                 │
                 ▼
    ┌──────────────────────────────────────┐
    │ webhook-receiver.cjs                 │
    │ (Local Node.js on port 3001)         │
    │ - Validates HMAC signature           │
    │ - Checks throttle window (15 min)    │
    │ - Writes to Electron data file       │
    │ - Logs all events to webhook-*.jsonl │
    └────────┬──────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────┐
    │ Local Data File                      │
    │ enquote-demo-data-v1.json           │
    │ (.../base44-app/...)                │
    │                                      │
    │ Meta fields:                         │
    │ - last_imported_at (timestamp)      │
    │ - sync_ttl_ms (300000 = 5 min)      │
    │ - last_snapshot_id                  │
    └────────┬──────────────────────────────┘
             │ File watcher
             ▼
    ┌──────────────────────────────────────┐
    │ Electron App (main.cjs)              │
    │ - Watches data file for changes      │
    │ - Auto-reloads all windows (debounce)│
    │ - Renders UI from local cache        │
    └──────────────────────────────────────┘
```

## Step 1: Start the Webhook Receiver

The webhook receiver must run continuously to accept Base44 payloads. Open a terminal and run:

```powershell
# Set Node.js path
$env:Path = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64;$env:Path"

# Navigate to project
cd C:\EnQuoteBuild

# Start the webhook receiver
node .\webhook-receiver.cjs
```

Expected output:
```
Webhook receiver listening on http://localhost:3001/api/base44/webhook
Secret loaded: configured
```

The receiver will:
- Validate incoming HMAC-SHA256 signatures using the secret from `.env`
- Check the 15-minute throttle window (only import if ≥15 min since last import)
- Write Base44 snapshots to the local app data file
- Log all events to `webhook-events.jsonl` for debugging
- Return HTTP 200 with import metadata

## Step 2: Start the Electron App

Open a **separate terminal** and run:

```powershell
# Set Node.js path
$env:Path = "C:\Users\croeschberger\OneDrive - Enphase Energy\Documents\node-v24.19.0-win-x64;$env:Path"

# Navigate to project
cd C:\EnQuoteBuild

# Build the app (uses VITE_DATA_SOURCE=local from .env.local)
npm run build

# Start the Electron app
npx electron .
```

**Note:** The `.env.local` file is already configured with `VITE_DATA_SOURCE=local`, so the app will start in local safe mode by default (no external API calls required).

**Important:** The app may display a sign-in/authentication window on first launch. This is normal behavior. You have two options:

### Option A: Close the Sign-In Window (For Testing)
- If a login window appears, you can close it
- The app will fall back to displaying local demo data
- This allows webhook imports to work with the demo data backend

### Option B: Complete Sign-In (Production Use)
- If you have valid credentials, sign in normally
- The app will then use the authenticated session
- Local webhook imports will merge with any authenticated data

The app will:
- Display the dashboard with demo seed quotes (if not signed in or in local mode)
- Watch the local data file for changes
- Auto-reload when webhook imports new data (debounced)
- Show cached quotes until the next sync window

## Step 3: Configure Base44 to Send Webhooks

Configure the Base44 sender with:

- **Endpoint URL:** `https://refold-frisk-scarce.ngrok-free.dev/api/base44/webhook`
  - (Update ngrok URL if it regenerates)
- **Shared Secret:** `afQ2E1gxnPZzN8ARf7S4CF9TErjWU4dt4iXECvoSUi0=`
- **Signature Header:** `X-ENQuote-Signature`
- **Schedule:** Every 15-20 minutes (or on change)
- **Payload format:** Schema version `enquote-local-sync-v1` with snapshot.entities structure

## Step 4: Test the Full Flow

The integration is now complete. Here's what happens:

### Initial State
- App starts with demo seed quotes (demo-q-1001, demo-q-1002, etc.)
- Dashboard shows 6 demo quotes

### When Base44 Sends Data
1. **Webhook arrives** at `http://localhost:3001/api/base44/webhook`
2. **Relay validates** HMAC-SHA256 signature using the shared secret
3. **Throttle check:**
   - If < 15 minutes since last import → return cached data (HTTP 200)
   - If ≥ 15 minutes since last import → import new snapshot
4. **Data file updated** with Base44 snapshot + metadata
5. **App auto-reloads** when file changes (debounced)
6. **Dashboard displays** imported quotes instead of demo seed data

### Response Examples

**First webhook (import succeeds):**
```json
{
  "ok": true,
  "received": true,
  "count": 1,
  "imported": true,
  "cached": false,
  "targetDir": "C:\\Users\\...\\AppData\\Roaming\\base44-app",
  "storedQuoteCount": 5,
  "storedProductCount": 8,
  "secondsUntilNextSync": 0
}
```

**Second webhook within 15 minutes (throttled):**
```json
{
  "ok": true,
  "received": true,
  "count": 1,
  "imported": false,
  "cached": true,
  "targetDir": "C:\\Users\\...\\AppData\\Roaming\\base44-app",
  "storedQuoteCount": 5,
  "storedProductCount": 8,
  "secondsUntilNextSync": 891
}
```

**After 15 minutes (import succeeds again):**
```json
{
  "ok": true,
  "received": true,
  "count": 1,
  "imported": true,
  "cached": false,
  "targetDir": "C:\\Users\\...\\AppData\\Roaming\\base44-app",
  "storedQuoteCount": 7,
  "storedProductCount": 10,
  "secondsUntilNextSync": 0
}
```

## File Locations

- **App data:** `C:\Users\<user>\AppData\Roaming\base44-app\enquote-demo-data-v1.json`
- **Webhook events log:** `C:\EnQuoteBuild\webhook-events.jsonl`
- **Shared secret:** `C:\EnQuoteBuild\.env` (must not be committed)
- **Source code:**
  - Webhook receiver: `C:\EnQuoteBuild\webhook-receiver.cjs`
  - Electron main: `C:\EnQuoteBuild\electron\main.cjs`
  - Repository layer: `C:\EnQuoteBuild\electron\repository.cjs`

## Data Structure

### Local Data File Format
```json
{
  "version": 1,
  "quotes": [
    {
      "id": "quote-id",
      "quote_number": "Q-001",
      "title": "Project Title",
      "description": "Project description",
      "status": "quote_sent_to_ho",
      "total_price": 25000,
      "currency": "USD",
      "created_date": "2026-09-01T...",
      "updated_date": "2026-09-01T..."
    }
  ],
  "products": [
    {
      "id": "prod-id",
      "name": "Product Name",
      "sku": "SKU-001",
      "unit_price": 500
    }
  ],
  "reviews": [],
  "activities": [],
  "followUps": [],
  "users": [],
  "pdfTemplates": [],
  "priceReviews": [],
  "siteFlags": [],
  "deletionRequests": [],
  "materialOrders": [],
  "rmas": [],
  "svCancels": [],
  "supportInteractions": [],
  "followUpConfigs": [],
  "pvManufacturers": [],
  "meta": {
    "sync_ttl_ms": 300000,
    "last_imported_at": "2026-09-01T...",
    "last_snapshot_id": null,
    "last_saved_at": "2026-09-01T..."
  }
}
```

### Base44 Webhook Payload Format

**Important:** Base44 always sends this payload AES-256-GCM encrypted (confirmed from live
deliveries on 2026-09-02). The outer envelope is plaintext JSON; only the `encryption.ciphertext`
field holds the actual encrypted snapshot. An earlier version of this doc (and of
`webhook-receiver.cjs`) assumed a flat, unencrypted `{ snapshot: { entities: {...} } }` shape that
never matched real deliveries - every "successful" import silently processed zero records for
hours until this was fixed. The real envelope shape is:

```json
{
  "schema_version": 1,
  "delivery_id": "b07f2fde-...",
  "sent_at": "2026-09-02T18:42:00.000Z",
  "mode": "snapshot",
  "encryption": {
    "algorithm": "AES-GCM",
    "encoding": "base64",
    "iv": "<base64, 12 bytes decoded>",
    "ciphertext": "<base64 - actual ciphertext with the 16-byte GCM auth tag APPENDED to the end, per the WebCrypto `crypto.subtle.encrypt` convention Base44's sender uses - there is NO separate `tag`/`authTag` field>"
  }
}
```

Once `encryption.ciphertext` is decrypted (last 16 bytes split off as the GCM tag, decrypted with
`ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY`), the resulting plaintext JSON is the actual snapshot:

```json
{
  "snapshot": {
    "entities": {
      "Quote": [
        {
          "id": "quote-001",
          "quote_number": "B44-001",
          "title": "...",
          "description": "...",
          "status": "...",
          "total_price": 12345,
          "currency": "USD",
          "created_date": "2026-09-01T...",
          "updated_date": "2026-09-01T..."
        }
      ],
      "Product": [
        {
          "id": "prod-001",
          "name": "...",
          "sku": "...",
          "unit_price": 500
        }
      ],
      "QuoteReview": [],
      "QuoteActivity": []
    }
  }
}
```

## Throttling & Caching

The webhook receiver implements **automatic throttling** to prevent constant app reloads:

- **Throttle window:** 15 minutes (900,000 ms)
- **Behavior:**
  - First webhook: imports data, updates `last_imported_at`
  - Subsequent webhooks within 15 min: return cached counts, no file write
  - After 15 min: next webhook imports fresh data
  - Response always includes `secondsUntilNextSync` (countdown)

This means:
- ✅ Base44 can send webhooks more frequently (e.g., every 5 min)
- ✅ App UI stays stable (no constant reloads)
- ✅ Only one import per 15-minute window (configurable via `DEFAULT_SYNC_TTL_MS` in repository.cjs)
- ✅ User can refresh app manually without triggering webhook reload

## Debugging

### Check webhook logs
```powershell
tail -f C:\EnQuoteBuild\webhook-events.jsonl
```

Each line is a JSON event with received timestamp and payload.

### Monitor webhook receiver console
The webhook receiver prints debug info when configured:
- "Resolved target directory: ..."
- "Current data loaded, has X quotes"
- "Time since last import: ... ms"
- "Webhook throttled - within sync window" (cached)
- "Importing new snapshot data" (fresh import)
- "Import complete, stored X quotes"

### Check local data file
```powershell
cat C:\Users\<user>\AppData\Roaming\base44-app\enquote-demo-data-v1.json | jq .meta
```

Shows:
- `last_imported_at`: When data was last imported
- `sync_ttl_ms`: Throttle window duration
- `last_snapshot_id`: ID of last imported snapshot (if provided)

### Verify app is watching file changes
When you send a webhook, look for app-reload in Electron console (in dev tools if available), or check system process to see if Electron restarts.

## Environment Variables

Set these before starting the services:

```powershell
# For webhook receiver
$env:ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET = "afQ2E1gxnPZzN8ARf7S4CF9TErjWU4dt4iXECvoSUi0="

# For Electron app
$env:VITE_DATA_SOURCE = "local"  # Use local adapter
$env:APPDATA = "C:\EnQuoteBuild\.run-appdata"  # Optional: override for testing
$env:LOCALAPPDATA = "C:\EnQuoteBuild\.run-localappdata"  # Optional: override for testing
```

## Security Notes

1. **Shared Secret:** Must match exactly between Base44 sender and `.env` file
   - Stored as base64 in `.env`
   - Decoded to binary buffer before HMAC calculation
2. **HMAC Validation:** Uses timing-safe comparison to prevent timing attacks
3. **Signature Format:** `X-ENQuote-Signature: sha256=<hex>`
4. **.env file:** Must NOT be committed to git (see `.gitignore`)

## Troubleshooting

### App crashes or shows sign-in window on launch
- This is expected behavior. The app tries to authenticate on startup
- **For testing/demo mode:** Close the sign-in window to use local demo data
- **For production:** Sign in with valid credentials
- The webhook relay works independently of authentication - it writes data to the local file
- When running in local mode (`VITE_DATA_SOURCE=local`), the app doesn't require authentication to display quotes

### Webhook returns 401 "Unauthorized: invalid signature"
- Check the secret in `.env` matches Base44 configuration
- Verify Base44 is signing the raw JSON body (not a stringified version)
- Ensure `X-ENQuote-Signature` header format is `sha256=<hex>`

### Webhook imports 0 quotes
- Check if target directory exists: `C:\Users\<user>\AppData\Roaming\base44-app`
- If first run, app may not have created it yet. Run the app once, close it, try webhook again.
- Check webhook-events.jsonl for error messages

### App doesn't reload after webhook
- Check Electron console for file watcher errors
- Verify webhook receiver actually wrote the file (check file timestamp)
- Ensure `VITE_DATA_SOURCE=local` is set

### ngrok tunnel URL changed
- Base44 will reject requests to the old URL
- Run `ngrok http 3001` to get new URL
- Update Base44 configuration with new URL
- Webhook receiver still listens on localhost:3001 internally

## Next Steps

1. ✅ Deploy webhook receiver as background service (Optional: use PM2 or Windows Service)
2. ✅ Configure Base44 to send webhooks on schedule (15-20 min interval)
3. ✅ Test end-to-end with real Base44 data
4. ✅ Monitor webhook-events.jsonl for issues
5. ✅ Adjust SYNC_THROTTLE_MS if different interval needed
6. ✅ Set up alerts if webhooks fail (e.g., check last_imported_at timestamp)
