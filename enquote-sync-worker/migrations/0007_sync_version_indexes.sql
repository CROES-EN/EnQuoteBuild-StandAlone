-- Keeps the cheap "has anything changed?" version checks to a single index lookup.
CREATE INDEX IF NOT EXISTS idx_base44_entity_state_synced_at ON base44_entity_state(synced_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
