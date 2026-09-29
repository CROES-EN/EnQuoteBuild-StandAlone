-- Stage 1: New table to store Base44-originated entity changes for desktop
-- reads, without ever writing back to Base44's API (which was causing the
-- self-triggering loop confirmed with Base44 tonight).
--
-- Composite key: entity_type + local_id (per Base44's spec), so repeated
-- create/update events for the same record simply overwrite the stored copy
-- rather than accumulating duplicate rows.
--
-- Apply with:
--   npx wrangler d1 execute enquote-sync --file .\stage1-d1-only-outbound.sql --remote

CREATE TABLE IF NOT EXISTS base44_entity_state (
  entity_type TEXT NOT NULL,
  local_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  record_json TEXT NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'base44',
  synced_at   TEXT NOT NULL,
  PRIMARY KEY (entity_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_base44_entity_state_type ON base44_entity_state(entity_type);
