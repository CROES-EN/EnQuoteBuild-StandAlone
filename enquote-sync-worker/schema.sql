-- EnQuote sync storage (D1). Apply with: npm run db:migrate

CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  quote_number    TEXT,
  local_quote_id  TEXT,
  payload         TEXT NOT NULL,
  updated_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_quote_number   ON quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotes_local_quote_id ON quotes(local_quote_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_items (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL DEFAULT 'quote',
  quote_id      TEXT,
  action        TEXT NOT NULL DEFAULT 'create',
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  remote_id     TEXT,
  conflict_with TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_items(status);

CREATE TABLE IF NOT EXISTS presence_sessions (
  session_id    TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  signed_in_at  TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence_sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_presence_email ON presence_sessions(email);