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
   npx wrangler secret put USER_TOKEN_SECRET
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
   npx wrangler d1 execute enquote-sync --remote --file=migrations/0005_collab.sql
   ```

## Enable cached snapshots and realtime quote updates

The Worker caches quote snapshots in KV and publishes `quotes_updated` messages
through a Durable Object WebSocket room. Deploy these additive resources from this
directory:

1. Create the KV namespace and copy the returned namespace ID:
   ```sh
   npx wrangler kv namespace create CACHE
   ```
2. Put that ID in `wrangler.jsonc` as the `CACHE` namespace ID.
3. Add the quote and outbound-item indexes:
   ```sh
   npx wrangler d1 execute enquote-sync --remote --file=migrations/0001_add_updated_at_index.sql
   ```
4. Deploy the Worker and its Durable Object migration:
   ```sh
   npx wrangler deploy
   ```

The `/ws` endpoint requires the per-session `SNAPSHOT_TOKEN`. Electron also sends
its dynamically issued Cloudflare Access service-token headers on the WebSocket
handshake. If the handshake still receives HTTP 403, inspect the Access policy for
the Worker hostname and `/ws` path; only add an Access bypass if the endpoint remains
protected by the Worker-validated snapshot token.

The desktop keeps its regular polling timers as fallback. When connected, the
WebSocket only signals that quote data changed; Electron then fetches the authorized
snapshot and entity data through the existing authenticated HTTP paths.

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
| `USER_TOKEN_SECRET` | Tasks, SOPs, messages | Signs per-user identity tokens and inbox keys |

The two token secrets are required for the Worker to return sync credentials, but a
missing token does not invalidate an already verified identity; the app logs that sync
is disabled. The service-token pair is optional and only needed for background
entity-snapshot requests. None of these values should be placed in the installer or
on each user's machine.
When `USER_TOKEN_SECRET` is configured, `/auth/sync-credentials` also returns a
30-day `userToken` plus `inboxKey`. The collaboration endpoints require both
`Authorization: Bearer <OUTBOUND_TOKEN>` and `X-EnQuote-User: <userToken>`; they
never trust a request-body email for identity.

After updating Worker code or secrets, deploy the Worker with `npx wrangler deploy`.
An unauthenticated request to `/auth/session` should redirect to the configured
Cloudflare Access sign-in page; after sign-in it should return JSON with
`authenticated: true` for an allow-listed user.

## Endpoints

When a desktop user deletes a quote, Electron sends the confirmed delete through
`/api/inbound/base44`. The Worker verifies the Base44 record, deletes it, then stores a
quote tombstone so future entity snapshots cannot restore it.

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

### Collaboration endpoints

Apply the additive collaboration migration before enabling EnQuote 1.3.0 clients:

```sh
npx wrangler d1 execute enquote-sync --remote --file=migrations/0005_collab.sql
```

New authenticated endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tasks?since=` | Personal task changes for the signed-in user |
| POST | `/api/tasks/upsert` | Last-writer-wins task upsert |
| POST | `/api/tasks/delete` | Task tombstone delete |
| GET | `/api/sops?since=` | Shared SOP changes |
| POST | `/api/sops/upsert` | SOP upsert and version write |
| POST | `/api/sops/delete` | Soft-delete an SOP |
| GET | `/api/sops/versions?id=` | SOP version history |
| POST | `/api/sops/files` | Upload/dedupe SOP file bytes in KV |
| GET | `/api/sops/files/<sha>` | Download SOP file bytes |
| GET/POST | `/api/chat/conversations` | List or create DM/group conversations |
| POST | `/api/chat/conversations/update` | Rename/add members/leave a group |
| GET/POST | `/api/chat/messages` | Page or send messages |
| POST | `/api/chat/read` | Mark a conversation read |
| GET | `/api/chat/inbox?since=` | Poll new inbox messages and unread total |
| GET | `/api/chat/directory` | Allow-listed chat directory |

Collaboration writes stamp server-side `synced_at` cursors with
`new Date().toISOString()`. Clients should request rows with `synced_at > since`
and advance `since` to the maximum cursor returned.

### Shared Supervisor Dashboard data

The Supervisor Dashboard's imported data (`supervisorDailyMetrics` and
`supervisorReportTables`) is mirrored through the Worker so every manager sees the same
records. Apply `migrations/0002_supervisor_records.sql` to D1 before deploying:

```sh
npx wrangler d1 execute enquote-sync --remote --file=migrations/0002_supervisor_records.sql
```

All endpoints use `OUTBOUND_TOKEN`; writes also require an allow-listed `email`.
`GET /api/supervisor/index`, `GET /api/supervisor/record?collection=&id=`,
`POST /api/supervisor/upsert`, `POST /api/supervisor/delete`. The newest `updatedAt`
stamp wins per record, deletions leave a tombstone, large records are split across
chunk rows (D1's 2 MB row limit), and each applied change broadcasts a
`supervisor_updated` WebSocket message so open dashboards refresh immediately. Desktop
apps also reconcile every 60 seconds as a fallback (`electron/supervisorSync.cjs`).

## Secrets

| Secret | Purpose |
|---|---|
| `ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET` | HMAC signature verification (same as Base44) |
| `ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY` | AES-256-GCM decryption (base64 32-byte key, same as Base44) |
| `SNAPSHOT_TOKEN` | Protects snapshot endpoint |
| `OUTBOUND_TOKEN` | Protects enqueue + status endpoints |
| `BASE44_API_KEY` | Base44 API key for outbound pusher |
| `BASE44_APP_ID` | Base44 App ID for entity URL construction |