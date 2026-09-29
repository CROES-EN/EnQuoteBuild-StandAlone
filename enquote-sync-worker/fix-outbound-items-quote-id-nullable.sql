-- Migration: make outbound_items.quote_id nullable, so non-quote entities
-- (Product, MaterialOrder, QuoteActivity, etc.) can be inserted without a
-- quote_id, matching the already-correct schema.sql file (which never had
-- NOT NULL on this column - the live D1 database drifted from it at some
-- point before this generic-entity feature was added).
--
-- SQLite/D1 does not support directly dropping a NOT NULL constraint via
-- ALTER TABLE, so this uses the standard rebuild pattern:
--   1. Create a new table with the corrected (nullable) schema.
--   2. Copy all existing rows over.
--   3. Drop the old table.
--   4. Rename the new table to the original name.
--   5. Recreate the index that existed on the original table.
--
-- Apply with:
--   npx wrangler d1 execute enquote-sync --file .\fix-outbound-items-quote-id-nullable.sql --remote

CREATE TABLE outbound_items_new (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL DEFAULT 'quote',
  quote_id      TEXT,
  action        TEXT NOT NULL DEFAULT 'create',
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  remote_id     TEXT,
  conflict_with TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);

INSERT INTO outbound_items_new (
  id, entity_type, quote_id, action, payload, status, remote_id, conflict_with, error_message, created_at, updated_at
)
SELECT
  id, entity_type, quote_id, action, payload, status, remote_id, conflict_with, error_message, created_at, updated_at
FROM outbound_items;

DROP TABLE outbound_items;

ALTER TABLE outbound_items_new RENAME TO outbound_items;

CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_items(status);
