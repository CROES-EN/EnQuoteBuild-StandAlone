-- Migration: Add updated_date column to base44_entity_state
ALTER TABLE base44_entity_state ADD COLUMN updated_date TEXT;

UPDATE base44_entity_state
SET updated_date = COALESCE(
  json_extract(record_json, '$.updated_date'),
  json_extract(record_json, '$.updated_at'),
  json_extract(record_json, '$.action_at'),
  synced_at
)
WHERE updated_date IS NULL;
