-- Migration for existing databases that have the old schema.
-- Run with: npx wrangler d1 execute enquote-sync --file=./migration.sql --remote

ALTER TABLE outbound_items ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'quote';
ALTER TABLE outbound_items ADD COLUMN remote_id TEXT;
ALTER TABLE outbound_items ADD COLUMN error_message TEXT;