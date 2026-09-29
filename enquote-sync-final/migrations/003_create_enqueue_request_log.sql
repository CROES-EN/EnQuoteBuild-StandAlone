-- Migration: Create enqueue_request_log table
-- Logs every request to /api/outbound/enqueue with caller-identifying
-- headers (User-Agent, CF-Connecting-IP, CF-Ray, CF-IPCountry).
-- Auto-cleaned by the reconciliation cron (entries older than 7 days).

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
