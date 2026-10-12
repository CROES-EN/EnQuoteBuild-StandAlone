CREATE TABLE retro_games_expanded (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tic', 'memory', 'connect', 'battleship', 'checkers')),
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
INSERT INTO retro_games_expanded SELECT * FROM retro_games;
DROP TABLE retro_games;
ALTER TABLE retro_games_expanded RENAME TO retro_games;
CREATE INDEX idx_retro_games_challenger ON retro_games(challenger, updated_at DESC);
CREATE INDEX idx_retro_games_opponent ON retro_games(opponent, updated_at DESC);
UPDATE retro_games SET expires_at = 9007199254740991 WHERE status = 'active';
