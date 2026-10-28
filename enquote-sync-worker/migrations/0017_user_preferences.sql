CREATE TABLE IF NOT EXISTS user_preferences (
  owner TEXT NOT NULL,
  key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  value TEXT,
  PRIMARY KEY (owner, key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_owner_synced_at
  ON user_preferences(owner, synced_at);
