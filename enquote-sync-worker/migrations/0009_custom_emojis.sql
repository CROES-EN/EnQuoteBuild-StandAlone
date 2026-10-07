CREATE TABLE IF NOT EXISTS custom_emojis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source_gif_id TEXT
);
