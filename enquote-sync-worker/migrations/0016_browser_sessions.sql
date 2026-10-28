CREATE TABLE IF NOT EXISTS user_passwords (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_login_attempts (
  attempt_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS base44_entity_state (
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  action TEXT NOT NULL,
  record_json TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'base44',
  synced_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, local_id)
);
