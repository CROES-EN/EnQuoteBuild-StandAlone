CREATE TABLE IF NOT EXISTS retro_mail_messages (
  id             TEXT PRIMARY KEY,
  sender_email   TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retro_mail_state (
  message_id  TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  folder      TEXT NOT NULL,
  read_at     TEXT,
  PRIMARY KEY (message_id, owner_email),
  FOREIGN KEY (message_id) REFERENCES retro_mail_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retro_mail_state_owner_folder
  ON retro_mail_state(owner_email, folder, message_id);

CREATE INDEX IF NOT EXISTS idx_retro_mail_messages_created_at
  ON retro_mail_messages(created_at DESC);
