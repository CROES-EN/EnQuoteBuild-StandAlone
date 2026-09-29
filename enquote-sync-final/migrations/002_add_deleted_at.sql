-- Migration: Add deleted_at column to base44_entity_state
-- This column supports soft-delete tombstones for delete propagation.
-- When a record is deleted in Base44, the Worker sets deleted_at instead of
-- hard-deleting the row, preserving it for audit/recovery.
-- handleEntitySnapshot filters WHERE deleted_at IS NULL.

ALTER TABLE base44_entity_state ADD COLUMN deleted_at TEXT;
