# enquote-sync — updated_date Fix (Option C)

## What changed

This version fixes a bug where the `/api/base44/webhook/entity-snapshot` endpoint
returned records without an `updated_date` field, causing the desktop app to
silently discard status changes from Base44.

### Three changes were made:

1. **`upsertBase44EntityState` (src/repository.js)** — now accepts an `updatedDate`
   parameter and stores it in a new `updated_date` column in `base44_entity_state`.
   Uses `COALESCE` on conflict to preserve a previously-stored real timestamp.

2. **`handleEntitySnapshot` (src/entity-snapshot.js)** — now injects `updated_date`
   into every record object using a 4-level fallback chain:
   - `record.updated_date` (already in record JSON)
   - `row.updated_date` (from the D1 column)
   - `record.updated_at` (if present in record JSON)
   - `row.synced_at` (last-resort — Worker write time)

3. **`handleEnqueue` (src/outbound.js)** — now extracts `updated_date` from the
   request body (`body.updatedDate`, `body.updated_date`, `record.updated_date`,
   or `record.updated_at`) and passes it through to `upsertBase44EntityState`.

### D1 migration

Run `migrations/001_add_updated_date.sql` to add the `updated_date` column and
backfill existing records.

## Who calls `/api/outbound/enqueue`?

The caller is an **automated sync process** (not the desktop app's `outboundSync.cjs`,
which posts to `/api/inbound/base44`). The evidence:

- No cron triggers exist on the Worker
- No internal self-call in the Worker code
- 13 of 15 Quote records in `base44_entity_state` have no corresponding
  `outbound_items` entry
- QuoteActivity records arrive every few seconds (automated, not manual)
- `record_json` in `base44_entity_state` does NOT contain `updated_date`,
  whereas `outbound_items` payloads (from the desktop app) DO

To get the genuine Base44 `updated_date` rather than the `synced_at` fallback,
the caller of `/api/outbound/enqueue` needs to include `updated_date` in the
request body.

## Deployment

```bash
npx wrangler d1 execute enquote-sync --file=migrations/001_add_updated_date.sql
npx wrangler deploy
```
