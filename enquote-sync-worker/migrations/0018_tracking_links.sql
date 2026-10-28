-- Read-only homeowner quote-tracking links. The URL carries "<id>.<HMAC(id)>", so a copy of
-- this table alone cannot produce a working link. Links never expire; revoke them instead.
CREATE TABLE IF NOT EXISTS tracking_links (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  failed_window_start TEXT,
  last_viewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_links_quote ON tracking_links(quote_id, revoked_at);
