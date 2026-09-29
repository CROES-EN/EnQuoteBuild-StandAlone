# enquote-sync — Final Version (all fixes applied)

## Summary of changes

This version includes all fixes from the 2026-09-29 session:

1. **`updated_date` injection** — `handleEntitySnapshot` now guarantees `updated_date` is present on every record, with a 4-level fallback chain.
2. **Delete propagation** — `upsertBase44EntityState` handles `action: "delete"` by setting `deleted_at` (tombstone). Uses INSERT ... ON CONFLICT so deletes for never-seen records aren't lost.
3. **`record: null` fix** — `handleEnqueue` uses `??` instead of `||` so explicit `null` from delete payloads is respected.
4. **Reconciliation cron** — Every 15 minutes, diffs `base44_entity_state` against Base44's API and tombstones records that no longer exist. Also cleans up `enqueue_request_log` entries older than 7 days.
5. **Request logging** — Every call to `/api/outbound/enqueue` is logged with User-Agent, IP, CF-Ray, and country.
6. **Manual reconcile endpoint** — `POST /api/reconcile` (auth with `SNAPSHOT_TOKEN`).

## D1 migrations

Three migrations are included in `migrations/`:

```bash
npx wrangler d1 execute enquote-sync --file=migrations/001_add_updated_date.sql
npx wrangler d1 execute enquote-sync --file=migrations/002_add_deleted_at.sql
npx wrangler d1 execute enquote-sync --file=migrations/003_create_enqueue_request_log.sql
```

**Note:** All three migrations have already been applied to the production D1 database. Only run them if you're setting up a fresh environment.

## Deployment

```bash
npx wrangler deploy
```

The cron trigger (`*/15 * * * *`) is configured in `wrangler.toml` under `[triggers]`.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/base44/webhook` | HMAC signature | Inbound webhook from local sync |
| GET | `/api/base44/webhook/snapshot` | SNAPSHOT_TOKEN | Full quote snapshot from `quotes` table |
| GET | `/api/base44/webhook/snapshot-meta` | SNAPSHOT_TOKEN | Last sync timestamp |
| POST | `/api/outbound/enqueue` | OUTBOUND_TOKEN | Enqueue entity state (create/update/delete) |
| POST | `/api/inbound/base44` | OUTBOUND_TOKEN | Push to Base44 |
| GET | `/api/base44/webhook/entity-snapshot` | SNAPSHOT_TOKEN | All active entities (excludes tombstoned) |
| GET | `/api/outbound/status` | OUTBOUND_TOKEN | Check outbound push status |
| POST | `/api/reconcile` | SNAPSHOT_TOKEN | Manual reconciliation trigger |
