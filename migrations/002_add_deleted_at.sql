-- Migration: Add deleted_at column to base44_entity_state
ALTER TABLE base44_entity_state ADD COLUMN deleted_at TEXT;
