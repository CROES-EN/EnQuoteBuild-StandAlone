CREATE INDEX IF NOT EXISTS idx_quotes_updated_at_desc
  ON quotes(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_items_status_updated_at_desc
  ON outbound_items(status, updated_at DESC);
