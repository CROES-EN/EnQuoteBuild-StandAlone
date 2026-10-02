-- Shared FST roster (Resource Planner). One row per FST; newest updated_at wins.
-- Apply with: npx wrangler d1 execute enquote-sync --remote --file=migrations/0003_fst_roster.sql

CREATE TABLE IF NOT EXISTS fst_roster (
  id          TEXT PRIMARY KEY,
  record_json TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
