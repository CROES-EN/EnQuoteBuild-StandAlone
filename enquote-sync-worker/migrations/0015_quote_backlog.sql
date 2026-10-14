CREATE TABLE quote_backlog_daily (
  date TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
