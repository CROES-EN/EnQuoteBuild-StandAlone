# Manual Refresh Button Feature

## Overview

The refresh button in the app dashboard now triggers a **webhook refresh** to import the latest Base44 data, bypassing the 15-minute throttle window.

## How It Works

### Before (Old Behavior)
- Refresh button → Reloads app with cached data
- Throttle window prevents new imports within 15 minutes
- User has to wait up to 15 minutes for new data to appear

### After (New Behavior)
- Refresh button → Requests fresh webhook import immediately
- Bypasses the 15-minute throttle for manual requests
- App receives latest data on demand
- Auto-reloads when import completes

## User Flow

1. **User clicks "Refresh"** button in app dashboard
2. **Confirmation dialog** appears: "Refresh the app to load the latest quote data? This will trigger the webhook to import fresh data."
3. **If user confirms:**
   - App sends request to webhook receiver's force-refresh endpoint
   - Webhook receiver bypasses throttle and imports fresh data
   - Local data file is updated
   - App auto-reloads with new quotes
4. **If user cancels:**
   - Nothing happens, app continues with current cached data

## Technical Implementation

### Changes Made

1. **webhook-receiver.cjs**
   - Added `/api/base44/webhook/refresh-now` endpoint (POST)
   - Bypasses the 15-minute throttle window
   - Accepts empty or current data payload
   - Returns import summary with `forced: true` flag

2. **electron/main.cjs**
   - Updated `app:refresh` IPC handler
   - Now sends HTTP request to force-refresh endpoint
   - Falls back to normal reload if webhook unavailable
   - Waits for import to complete before reloading

3. **src/Layout.jsx**
   - Updated confirmation message
   - Now says "This will trigger the webhook to import fresh data"
   - Still uses existing `enquoteLocal.app.refresh()` API

### API Endpoints

| Endpoint | Method | Purpose | Throttle |
|----------|--------|---------|----------|
| `/api/base44/webhook` | POST | Normal webhook import | Yes (15 min) |
| `/api/base44/webhook/refresh-now` | POST | Manual refresh import | No (bypassed) |
| `/health` | GET | Health check | N/A |

### Force-Refresh Response

```json
{
  "ok": true,
  "received": true,
  "count": 1,
  "imported": true,
  "cached": false,
  "forced": true,
  "targetDir": "C:\\Users\\...\\AppData\\Roaming\\base44-app",
  "storedQuoteCount": 5,
  "storedProductCount": 8
}
```

## Benefits

✅ **On-Demand Data Refresh**
- Users don't have to wait 15 minutes for new data
- Useful when expecting urgent quote updates

✅ **Maintains Throttle for Automatic Webhooks**
- Scheduled Base44 webhooks still throttled (every 15 min)
- Prevents webhook spam from constantly reloading the UI
- Manual refreshes bypass throttle for immediate data

✅ **Backward Compatible**
- Falls back to normal reload if webhook unavailable
- Works in offline mode (just reloads cached data)
- No changes to remote environments

## Usage Examples

### Scenario 1: Fresh Quote Available
1. User clicks "Refresh" button
2. Webhook imports latest Base44 quotes (bypassing throttle)
3. Dashboard updates with new quote data
4. User can see new quote immediately

### Scenario 2: Webhook Unavailable
1. User clicks "Refresh" button
2. App tries to contact webhook receiver
3. Connection fails (receiver not running)
4. App falls back to normal reload
5. Shows cached data (no errors)

### Scenario 3: Multiple Refreshes
1. User clicks "Refresh" → imports at 12:00 PM
2. User clicks "Refresh" again at 12:05 PM
3. Each click triggers import immediately
4. No 15-minute wait between manual refreshes
5. Scheduled Base44 webhooks still throttled

## Configuration

No additional configuration needed. The feature works automatically with:
- Webhook receiver on localhost:3001
- `.env.local` set to `VITE_DATA_SOURCE=local`
- App running in Electron

## Monitoring

Check webhook logs to see manual refresh requests:

```bash
Get-Content webhook-events.jsonl -Tail 10
```

Look for requests to `/refresh-now` endpoint (manual) vs `/webhook` (automatic).

## Troubleshooting

### Refresh button doesn't trigger import
- Verify webhook receiver is running: `node webhook-receiver.cjs`
- Check if port 3001 is accessible: `Test-NetConnection localhost -Port 3001`
- Look for errors in webhook receiver console

### Data doesn't reload after refresh
- Ensure app is in local mode: check `.env.local` has `VITE_DATA_SOURCE=local`
- Verify file watcher is active in app console
- Check webhook logs for import errors

### Still have old data after refresh
- Wait for file watcher to detect changes (usually < 1 second)
- Try refresh again if first attempt incomplete
- Check webhook logs for warnings

## Status

✅ **Feature Complete & Tested**
- Refresh button wired to webhook receiver
- Force-refresh endpoint implemented
- Throttle properly bypassed for manual requests
- Build succeeds without errors
