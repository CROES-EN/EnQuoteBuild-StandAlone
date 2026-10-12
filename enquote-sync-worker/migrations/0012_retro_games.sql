CREATE TABLE IF NOT EXISTS retro_games (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tic', 'memory')),
  challenger TEXT NOT NULL,
  opponent TEXT NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (challenger != opponent)
);
CREATE INDEX IF NOT EXISTS idx_retro_games_challenger ON retro_games(challenger, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_retro_games_opponent ON retro_games(opponent, updated_at DESC);
