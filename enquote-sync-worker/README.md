# enquote-sync

Always-on EnQuote ↔ Base44 sync layer on Cloudflare Workers.

## What changed from the old setup

| Old (local host) | New (this Worker) |
|---|---|
| Receiver behind a tunnel; host offline = missed webhooks | Webhook endpoint always on at `enphase-enquote.com` |
| 15-min write throttle + holding file | Atomic D1 transactions, no throttle needed |
| Webhook drops if it arrives mid-window | Idempotent by delivery_id — redeliveries skipped, not dropped |
| 5-min outbound poll timer, direct to Base44 | Event-driven via Worker; retries with backoff + dead-letter queue |
| Timestamp conflict check on the host | Same check, in the Worker, with durable `conflict` status in D1 |

## Deploy on a new machine

1. Clone this repo and install:
   ```sh
   git clone <from card> enquote-sync
   cd enquote-sync
   npm install
   ```
2. Login to Cloudflare:
   ```sh
   npx wrangler login
   ```
3. Set secrets (same values as your other machine):
   ```sh
   npx wrangler secret put ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET
   npx wrangler secret put ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY
   npx wrangler secret put SNAPSHOT_TOKEN
   npx wrangler secret put OUTBOUND_TOKEN
   npx wrangler secret put BASE44_API_KEY
   npx wrangler secret put BASE44_APP_ID
   ```
4. Deploy:
   ```sh
   npx wrangler deploy
   ```
5. Apply schema (if not already done):
   ```sh
   npx wrangler d1 execute enquote-sync --file=./schema.sql --remote
   ```

## Update your local app

1. Copy `outboundSync.new.cjs` to your app's `electron/outboundSync.cjs`
2. Update `main.cjs` config:
   ```js
   createOutboundSync({
     repository,
     config: {
       workerUrl: "https://enphase-enquote.com",
       outboundToken: process.env.OUTBOUND_TOKEN || ""
     },
     onAfterWrite: markOwnWrite
   });
   ```
3. Add `OUTBOUND_TOKEN=<value>` to your `.env` file

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/base44/webhook` | X-ENQuote-Signature (HMAC) | Inbound delivery from Base44 |
| GET | `/api/base44/webhook/snapshot` | Bearer `SNAPSHOT_TOKEN` | Full quote snapshot for teammates |
| POST | `/api/outbound/enqueue` | Bearer `OUTBOUND_TOKEN` | Queue a local edit for push |
| GET | `/api/outbound/status` | Bearer `OUTBOUND_TOKEN` | Check status of a queued item |

## Secrets

| Secret | Purpose |
|---|---|
| `ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` | HMAC signature verification (same as Base44) |
| `ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` | AES-256-GCM decryption (base64 32-byte key, same as Base44) |
| `SNAPSHOT_TOKEN` | Protects snapshot endpoint |
| `OUTBOUND_TOKEN` | Protects enqueue + status endpoints |
| `BASE44_API_KEY` | Base44 API key for outbound pusher |
| `BASE44_APP_ID` | Base44 App ID for entity URL construction |