CREATE TABLE IF NOT EXISTS retro_scores (
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('snake', 'memory', 'solitaire')),
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, kind)
);
