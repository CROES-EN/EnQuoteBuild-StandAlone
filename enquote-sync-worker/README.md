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
   npx wrangler secret put ALLOWED_EMAILS_LIST
   npx wrangler secret put ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET
   npx wrangler secret put ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY
   npx wrangler secret put SNAPSHOT_TOKEN
   npx wrangler secret put OUTBOUND_TOKEN
   npx wrangler secret put CF_ACCESS_CLIENT_ID
   npx wrangler secret put CF_ACCESS_CLIENT_SECRET
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

## Desktop Cloudflare Access sign-in

The desktop app opens only after `/auth/session` validates the Cloudflare Access JWT
and confirms the email against the Worker secret `ALLOWED_EMAILS_LIST`. The app then
uses that verified email directly; users do not need a separate EnQuote password or
per-computer shared-sync secret. The Cloudflare Access application must protect
`enquote-sync.croeschberger.workers.dev`, and its
application audience must match `POLICY_AUD` in `src/auth-session.js`. Keep the
team-domain and Worker URL constants in `src/auth-session.js` and
`../electron/cloudflareAuth.cjs` aligned with the Cloudflare Access configuration.

Configure these Worker secrets with `npx wrangler secret put <NAME>`:

| Secret | Required for | Purpose |
|---|---|---|
| `ALLOWED_EMAILS_LIST` | Sign-in | Comma-separated, allow-listed email addresses |
| `OUTBOUND_TOKEN` | App sync | Enables dynamic outbound sync credentials |
| `SNAPSHOT_TOKEN` | App sync | Enables dynamic snapshot sync credentials |
| `CF_ACCESS_CLIENT_ID` | Entity snapshot sync | Optional Access service-token ID |
| `CF_ACCESS_CLIENT_SECRET` | Entity snapshot sync | Optional Access service-token secret |

The two token secrets are required for the Worker to return sync credentials, but a
missing token does not invalidate an already verified identity; the app logs that sync
is disabled. The service-token pair is optional and only needed for background
entity-snapshot requests. None of these values should be placed in the installer or
on each user's machine.

After updating Worker code or secrets, deploy the Worker with `npx wrangler deploy`.
An unauthenticated request to `/auth/session` should redirect to the configured
Cloudflare Access sign-in page; after sign-in it should return JSON with
`authenticated: true` for an allow-listed user.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/base44/webhook` | X-ENQuote-Signature (HMAC) | Inbound delivery from Base44 |
| GET | `/api/base44/webhook/snapshot` | Bearer `SNAPSHOT_TOKEN` | Full quote snapshot for teammates |
| POST | `/api/outbound/enqueue` | Bearer `OUTBOUND_TOKEN` | Queue a local edit for push |
| GET | `/api/outbound/status` | Bearer `OUTBOUND_TOKEN` | Check status of a queued item |

Presence endpoints use `OUTBOUND_TOKEN`: `POST /api/presence/heartbeat`,
`GET /api/presence`, and `POST /api/presence/remove`. Presence is stored in D1 per
desktop session. The app sends a heartbeat every 45 seconds; sessions expire after
two minutes without one so a crash or network interruption cannot leave someone
shown as online indefinitely.

## Secrets

| Secret | Purpose |
|---|---|
| `ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` | HMAC signature verification (same as Base44) |
| `ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` | AES-256-GCM decryption (base64 32-byte key, same as Base44) |
| `SNAPSHOT_TOKEN` | Protects snapshot endpoint |
| `OUTBOUND_TOKEN` | Protects enqueue + status endpoints |
| `BASE44_API_KEY` | Base44 API key for outbound pusher |
| `BASE44_APP_ID` | Base44 App ID for entity URL construction |