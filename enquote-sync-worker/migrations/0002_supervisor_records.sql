-- Shared Supervisor Dashboard data (daily metrics + imported report tables).
-- Apply with: npx wrangler d1 execute enquote-sync --remote --file=migrations/0002_supervisor_records.sql

CREATE TABLE IF NOT EXISTS supervisor_records (
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  PRIMARY KEY (collection, id)
);

CREATE TABLE IF NOT EXISTS supervisor_record_chunks (
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  version     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (collection, id, version, chunk_index)
);
