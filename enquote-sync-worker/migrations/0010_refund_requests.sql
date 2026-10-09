CREATE TABLE IF NOT EXISTS refund_requests (
  id                  TEXT PRIMARY KEY,
  external_response_id TEXT NOT NULL UNIQUE,
  submitted_at        TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  data                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refund_requests_submitted_at
  ON refund_requests(submitted_at DESC);

CREATE TABLE IF NOT EXISTS refund_request_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL REFERENCES refund_requests(id),
  occurred_at TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  details     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refund_request_audit_request
  ON refund_request_audit(request_id, occurred_at);
