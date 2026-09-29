-- Migration: Create enqueue_request_log table
CREATE TABLE IF NOT EXISTS enqueue_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  path TEXT,
  method TEXT,
  user_agent TEXT,
  cf_ip TEXT,
  cf_ray TEXT,
  cf_country TEXT,
  auth_prefix TEXT,
  entity_type TEXT,
  action TEXT,
  local_id TEXT,
  body_size INTEGER
);
