# enquote-sync

Always-on EnQuote ↔ Base44 sync layer on Cloudflare Workers.

## Shared browser and desktop runtime

The browser uses the same React screens as Electron, with `workerAdapter` for
entity reads/writes and an HTTP-backed `window.enquoteLocal` compatibility bridge
for tasks, SOPs, chat, profiles, administration, and shared reports. A plain browser
configured as `local` now selects the Worker instead of an empty desktop repository.
Electron continues to use its native preload bridge and local persistence.

- From the repository root, `npm run build:web` explicitly selects the browser
  runtime. Deploy that build with this Worker's static asset binding; do not upload
  a desktop UI bundle accidentally.
- `/auth/session` validates company Access identity or a signed EnQuote session.
  Browser login sets a Secure, HttpOnly, SameSite=Strict cookie. The browser does not
  need the Base44 API key, outbound token, or snapshot token.
- Password provisioning requires a verified company Access identity matching the
  requested email. Knowing an allowed email is not enough. Password login is
  rate-limited per account/IP.
- `/auth/sync-credentials` remains a legacy desktop bootstrap endpoint and requires
  verified company Access identity, not a password-session cookie. Access users can
  still obtain legacy shared credentials through this endpoint; this is not a
  device-attested desktop-only boundary.
- `/api/web-snapshot` provides the shared entity snapshot and lightweight
  `?meta=1` version checks. `/api/web-entities` performs authenticated writes.
  Browser quote revisions are response-only and are not imported as Electron's
  numeric local revision counters.
- `/api/browser/*` forwards only allowlisted operations after verifying browser
  identity and effective role. Service authorization is added inside the Worker.
  Shared RMA/manufacturer/report collections use supervisor storage, matching
  Electron, rather than a second browser-only copy.
- `/api/outbound/enqueue` is Base44-to-D1 ingestion only, despite older descriptions
  below. It never pushes changes back to Base44. Desktop outbound writes use
  `/api/inbound/base44`; browser entity writes use `/api/web-entities`.
- Browser WebSockets use the verified session and the same Durable Object room as
  desktop. Visible tabs retain a 30-second polling fallback. Report records are
  fetched with bounded concurrency and cached by version; large tables can be
  retrieved individually.

### Rollout and acceptance

Before deploying, inspect the existing production schema. Apply additive migration
`migrations/0016_browser_sessions.sql` for entity storage, password provisioning,
and login throttling, then `migrations/0002_add_entity_state_index.sql` for entity
indexes if absent. Existing installations also require the prior collaboration,
profile/admin, supervisor, and feature migrations used by their desktop version.
Do not reset or replace existing D1 data. Newly created databases should first
apply `schema.sql`.

The extended supervisor collections require a desktop application release, not
only a renderer hotfix. Build and validate both clients before production rollout.
Browser file uploads/downloads replace supported native file workflows. The browser
can import OneNote PDF/Word/text/image exports as shared SOP pages, preview them,
and download the original files. Native .one conversion remains desktop-only.
Refund file transfer offers processor-authorized CSV import/export instead of
local workbook automation. Uploads add new validated requests only; existing
records are not overwritten or deleted. Exported cells are protected against
spreadsheet formula execution. The existing disabled refund feature gate is
preserved for both clients and for the new CSV import endpoint; this workflow
must not be activated before the integration is approved. Local workbook
automation and remote desktop commands remain desktop-only.
Manual browser follow-up email delivery is
not yet configured and must not report a successful send. Device-specific theme
and navigation preferences are not synchronized.

Local regression tests and builds are not proof of deployed parity. Acceptance
requires the same account in both deployed clients: create, edit, and delete a
quote in each direction without restarting; verify no deleted quote returns;
then verify reports/RMAs, tasks, SOP conflict handling, messages, profiles, and
admin role changes. Also verify expired sessions, failed requests, and logout.

Production rollout (2026-10-28): D1 was exported, migrations 0002 (entity state
indexes), 0015 and 0016 were applied (0015 made idempotent because
`quote_backlog_daily` already existed unrecorded), and the browser build was
deployed with `wrangler deploy --assets <web build dir>` as version
`c1f618cd-a629-490e-a925-08ab3756630e`. The previous version was
`7d951ab2-8e65-4e11-be68-e77d9a6fe79e`. To roll back, run
`npx wrangler rollback 7d951ab2-8e65-4e11-be68-e77d9a6fe79e`. The migrations are
additive and do not need to be reverted. Production `base44_entity_state` also has
legacy `updated_date`/`deleted_at` columns; deletions are represented by
`action = 'delete'`, which the snapshot uses.

Settings sync (2026-10-28): migration 0017 (`user_preferences`) was applied and
version `6b9efcb3-85cd-4dc8-b12e-5d6156ddc17a` was deployed with
`GET /api/preferences` and `POST /api/preferences/upsert`. Clients sync only the
allowlisted per-user customization keys in `src/lib/preferenceSync.js` (newest
`updatedAt` wins; pre-existing desktop values win the first sync). Desktop
upload requires a desktop release that includes the new preload/IPC handlers.
To roll back only this feature, run
`npx wrangler rollback c1f618cd-a629-490e-a925-08ab3756630e`; the table can stay.

Data parity (2026-10-28): version `d54f4ac8-69c6-45f9-9d43-e4a573a24fa5` stops
the shared snapshot from treating legacy lowercase `entity_type='quote'` rows
(written by the old `/api/outbound/enqueue` path) as extra quotes, and bumps the
snapshot cache key to `snapshot:all-v6`. `/api/inbound/base44` now also records
desktop shared-collection pushes (SiteFlag, PVPanelRMA, QuoteReview, ...) in
`base44_entity_state` under their Base44 id and broadcasts `entities_updated`.
The matching desktop release uploads collection creates/edits/deletes through
`outboundEntityQueue` and applies server deletion tombstones. Roll back with
`npx wrangler rollback 6b9efcb3-85cd-4dc8-b12e-5d6156ddc17a`.

Homeowner tracking links (2026-10-28): version `80f8e25f-9acd-4264-9038-af194fcbdb4a`
with migration `0018_tracking_links.sql`. Staff create, read and revoke one link per
quote via `POST /api/tracking-links/create`, `GET /api/tracking-links?quoteId=`
and `POST /api/tracking-links/revoke` (also through the browser gateway). The
public page is `GET /track/<token>`; the homeowner must enter the quote's site ID
(`POST /track/<token>/verify`, 5 failures per 15 minutes per link, then 429),
which sets a 30-day `__Host-enquote_track` cookie for `GET /track/<token>/status`.
Only the friendly stage, dated timeline, quote number and next step are returned.
Tokens are HMAC-signed with `TRACKING_LINK_SECRET` (falls back to
`USER_TOKEN_SECRET`); only the link id is stored. `PUBLIC_TRACKING_URL`
(`https://enphase-enquote.com` in `wrangler.jsonc`, version
`b9f8c599-0e1f-497c-a99b-cf04049c146d`, which also returns 404 for every other
`/track` path so the bypass never exposes the app shell) sets the hostname used in issued links. **Cloudflare Access must bypass `/track/*`**
on `enphase-enquote.com`
(Zero Trust → Access → Applications → add a Bypass/Everyone policy for that path),
otherwise homeowners see the Access login. Roll back with
`npx wrangler rollback d54f4ac8-69c6-45f9-9d43-e4a573a24fa5`; the table can stay.

Build browser assets with `--mode web` into a separate directory and pass it with
`--assets`, so the desktop `dist` output is never overwritten.

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
| `USER_TOKEN_SECRET` | Tasks, SOPs, messages, Mail Center | Signs per-user identity tokens and inbox keys |

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

Message reactions additionally require the additive migration below before
deploying the updated Worker and desktop bridge:

```sh
npx wrangler d1 execute enquote-sync --remote --file=migrations/0008_chat_reactions.sql
```

Reactions are stored per message, authenticated user, and emoji. A person may
select several different reactions. Setting `active: true` adds one idempotently;
`active: false` removes only that user's selection. Only current conversation
members may read or change reactions. Reaction updates broadcast
`chat_reactions_updated` to member inbox keys, without creating messages,
unread counts, or desktop new-message alerts.

Shared custom emojis require the following additive migration before deploying
the updated Worker and desktop:

```sh
npx wrangler d1 execute enquote-sync --remote --file=migrations/0009_custom_emojis.sql
```

`GET /api/chat/emojis` lists the shared catalog. `POST /api/chat/emojis?name=...`
uploads raw PNG, JPEG, WebP, or GIF bytes (maximum 512 KiB) with a matching
Content-Type and image signature. Names are unique, 1-32 lowercase letters,
numbers, underscores, or hyphens, starting with a letter or number. Image hashes
are immutable IDs; uploading the same image/name is idempotent. The catalog lives
in D1 and image bytes in the existing CACHE KV namespace without an expiry.
`GET /api/chat/emojis/image?id=...` returns an authenticated, private, no-store
image response. All three endpoints require an allow-listed signed-in user;
the catalog is shared across conversations, unlike membership-scoped screenshots.

Messages accept `{type: "custom_emoji", emojiId: "<sha256>"}`; the server verifies
catalog membership and supplies the canonical name. Built-in artwork can be sent
as `{type: "builtin_emoji", emojiId: "<existing reaction ID>"}`. Reactions accept
`custom:<sha256>` only for catalog-backed images, with the existing message and
conversation membership checks. These additions do not change existing reaction
IDs or alert/unread behavior. No emoji deletion endpoint is provided.

`POST /api/chat/emojis/from-gif` accepts `{name, gifId}`. The server resolves the
ID through GIPHY using `GIPHY_API_KEY`, restricts it to G/PG results, chooses a
small GIF rendition, and verifies the bytes and the 512 KiB limit while streaming.
Only allow-listed HTTPS GIPHY media hosts are fetched, without user/service
credentials or following media redirects. Animation bytes and source GIF IDs
are retained for rendering and attribution. GIFs that cannot fit the emoji
limit fail explicitly; they are never silently converted to static images.

Messages also accept validated `app_link` attachments containing `label`, an
internal `path`, and a `target` descriptor (`record`, `id`, `testid`, `text`, or
`page`). External URLs, credential-bearing paths, and arbitrary CSS selectors are
rejected. The desktop recipient navigates through normal page access checks and
highlights the matched element for 5 seconds. No additional D1 migration is needed
for these attachments; deploy the updated Worker before enabling the new UI.

`assigned_task` requests reuse the atomic case-tag message/task transaction.
The sole attachment supplies `version: 1`, `recipient`, `title` (up to 200 chars),
`note` (up to 2000 chars), and canonical UTC `dueAt`. The recipient must be another
active conversation member on the allowed-email list, in a DM or group. The server
consumes the attachment, creates `chat-task:<clientId>` in the recipient's personal
Tasks, and returns `assignedTaskId`. Reusing the request ID cannot duplicate or
resurrect the task. No new migration is required for general assignments.

The global task panel sends `assigned_task` version 2, with up to 4000 characters
of notes and an additional allowlisted `task` object: `type`, `remind_at`,
`quote_id`, `quote_label`, `site_id`, `case_number`, `case_id`, `contact_name`, and
`contact_phone`. Nullable reminder timestamps must be canonical UTC; identifiers
remain strings, preserving leading zeros. Ownership, completion state, and sender
identity remain server-controlled. Version 1 retains its original behavior.
Deploy this Worker update before enabling panel assignments; older Workers reject
version 2 explicitly rather than silently dropping fields. No new migration is
needed for this version change.

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
| GET | `/api/chat/reactions?conversationId=&messageIds=` | Reaction summaries for up to 99 comma-separated message IDs |
| POST | `/api/chat/reactions` | Set `{conversationId, messageId, emoji, active}`; supported emoji IDs are `thumbs_up`, `heart`, `laugh`, `surprised`, `sad`, `celebrate` |
| POST | `/api/chat/read` | Mark a conversation read |
| GET | `/api/chat/inbox?since=` | Poll new inbox messages and unread total |
| GET | `/api/chat/directory` | Allow-listed chat directory |

The separate retro Mail Center stores independent one-to-one mail and never creates
or opens a Messages conversation. Apply its additive schema before deploying the
Worker:

```sh
npx wrangler d1 migrations apply enquote-sync --remote
npx wrangler deploy
```

`GET /api/retro-mail?folder=inbox|sent|saved|junk|trash|contacts` returns only the
signed-in user's mailbox state. `POST /api/retro-mail/send` delivers to an active
allow-listed user; `POST /api/retro-mail/state` marks a received message read or
moves one of the caller's copies between folders; `POST /api/retro-mail/delete`
permanently removes only the caller's copy from Trash. The recipient's copy is
independent from the sender's Sent copy. Realtime mail changes are scoped to the
sender and recipient inbox keys. Drafts remain local to the current computer and
user.

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
| `REFUND_INGEST_TOKEN` | Secures Power Automate refund-request submissions |

### Enphase Care refund requests

Apply `migrations/0010_refund_requests.sql` and configure `REFUND_INGEST_TOKEN` before enabling
the secured Forms ingestion endpoint:

```sh
npx wrangler d1 execute enquote-sync --remote --file=migrations/0010_refund_requests.sql
npx wrangler secret put REFUND_INGEST_TOKEN
npx wrangler deploy
```

The normalized Forms contract and optional machine ingestion route are documented in
[`../docs/refund-request-power-automate.md`](../docs/refund-request-power-automate.md). EnQuote
submissions no longer depend on a Power Automate HTTP flow; the desktop app uses the authenticated
local workbook synchronization flow described there.