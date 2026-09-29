-- Migration: Add updated_date column to base44_entity_state
-- This column stores the genuine Base44 last-modified timestamp per record,
-- separate from synced_at (which is when the Worker wrote the row).

ALTER TABLE base44_entity_state ADD COLUMN updated_date TEXT;

-- Backfill existing records using the best available timestamp:
-- 1. updated_date from record_json (if the caller already included it)
-- 2. updated_at from record_json (alternative field name)
-- 3. action_at from record_json (for QuoteActivity records)
-- 4. synced_at (last-resort fallback — Worker write time)

UPDATE base44_entity_state
SET updated_date = COALESCE(
  json_extract(record_json, '$.updated_date'),
  json_extract(record_json, '$.updated_at'),
  json_extract(record_json, '$.action_at'),
  synced_at
)
WHERE updated_date IS NULL;
