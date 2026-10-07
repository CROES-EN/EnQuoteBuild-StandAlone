CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id TEXT NOT NULL,
  email TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, email, emoji)
);
