-- Error reports sent by the desktop apps. Apply with:
--   npx wrangler d1 execute enquote-sync --remote --file=migrations/0004_error_reports.sql
CREATE TABLE IF NOT EXISTS error_reports (
  fingerprint TEXT NOT NULL,
  email       TEXT NOT NULL,
  app_version TEXT,
  ui_version  TEXT,
  source      TEXT,
  message     TEXT,
  stack       TEXT,
  page        TEXT,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (fingerprint, email)
);
CREATE INDEX IF NOT EXISTS idx_error_reports_last_seen ON error_reports(last_seen);
