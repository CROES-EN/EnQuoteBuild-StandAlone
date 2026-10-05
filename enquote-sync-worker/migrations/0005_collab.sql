-- EnQuote 1.3.0 collaboration data (personal tasks, shared SOPs, messages).
-- Apply with: npx wrangler d1 execute enquote-sync --remote --file=migrations/0005_collab.sql

CREATE TABLE IF NOT EXISTS user_tasks (
  owner      TEXT NOT NULL,
  id         TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at  TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,
  PRIMARY KEY (owner, id)
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_owner_synced_at
  ON user_tasks(owner, synced_at);

CREATE TABLE IF NOT EXISTS sop_docs (
  id         TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  synced_at  TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  data       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sop_docs_synced_at
  ON sop_docs(synced_at);

CREATE TABLE IF NOT EXISTS sop_versions (
  doc_id     TEXT NOT NULL,
  version    TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,
  PRIMARY KEY (doc_id, version)
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,
  name                 TEXT,
  dm_key               TEXT UNIQUE,
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_message_at      TEXT,
  last_message_preview TEXT,
  last_sender          TEXT
);

CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id TEXT NOT NULL,
  email           TEXT NOT NULL,
  joined_at       TEXT NOT NULL,
  last_read_at    TEXT,
  left_at         TEXT,
  PRIMARY KEY (conversation_id, email)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_email
  ON chat_members(email);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender          TEXT NOT NULL,
  body            TEXT NOT NULL,
  attachments     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created_at
  ON chat_messages(conversation_id, created_at);
