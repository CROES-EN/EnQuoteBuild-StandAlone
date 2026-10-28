-- Migration: Add index for entity snapshot queries
-- The snapshot endpoint now reads ALL entities from base44_entity_state
-- ordered by synced_at DESC. Without this index, every snapshot pull
-- (20 users × periodic polls) does a full table scan + sort on 7,644+ rows.
--
-- Apply with: npx wrangler d1 execute enquote-sync --remote --file=migrations/0002_add_entity_state_index.sql

CREATE INDEX IF NOT EXISTS idx_entity_state_synced_at
  ON base44_entity_state(synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_state_type
  ON base44_entity_state(entity_type, action);

PRAGMA optimize;
