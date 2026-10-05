-- EnQuote 1.4.0: admin overrides, audit log, profile pictures and session details.
-- Apply once with: npx wrangler d1 execute enquote-sync --remote --file=migrations/0006_admin_profiles.sql

-- Per-user overrides set from the Admin Menu. They win over Base44, so a role change made in
-- EnQuote is never undone by the next Base44 sync. NULL columns mean "use Base44's value".
CREATE TABLE IF NOT EXISTS admin_user_overrides (
  email            TEXT PRIMARY KEY,
  app_role         TEXT,
  additional_roles TEXT,
  allow_pages      TEXT NOT NULL DEFAULT '[]',
  deny_pages       TEXT NOT NULL DEFAULT '[]',
  updated_by       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- App-wide admin settings as JSON values, e.g. 'role_pages' and 'announcement'.
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at);

CREATE TABLE IF NOT EXISTS user_profiles (
  email      TEXT PRIMARY KEY,
  avatar_id  TEXT,
  updated_at TEXT NOT NULL
);

-- Session details for the Admin Menu's live session list (not idempotent: run this file once).
ALTER TABLE presence_sessions ADD COLUMN app_version TEXT;
ALTER TABLE presence_sessions ADD COLUMN ui_version TEXT;
ALTER TABLE presence_sessions ADD COLUMN resolved_role TEXT;
