/**
 * Repository layer — D1 database operations.
 *
 * CHANGES:
 * - upsertBase44EntityState now accepts `updatedDate` and stores it in the
 *   `updated_date` D1 column (added via migration).
 * - upsertBase44EntityState handles `action: "delete"` by setting `deleted_at`
 *   (tombstone). Uses INSERT ... ON CONFLICT DO UPDATE so deletes for
 *   never-seen records create a tombstone row instead of silently no-oping.
 * - On normal create/update, `deleted_at` is cleared (NULL) so a re-created
 *   record un-tombstones automatically.
 */

async function applyInboundEvent(db, event) {
  const receivedAt = new Date().toISOString();
  const inserted = await db
    .prepare("INSERT OR IGNORE INTO webhook_events (event_id, received_at) VALUES (?, ?)")
    .bind(event.id, receivedAt)
    .run();
  if (inserted.meta.changes === 0) return { duplicate: true };

  const quotes = event.quotes || (event.quote ? [event.quote] : []);
  for (const quote of quotes) {
    await db
      .prepare(
        `INSERT INTO quotes (id, quote_number, local_quote_id, payload, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at,
           quote_number = excluded.quote_number,
           local_quote_id = excluded.local_quote_id`
      )
      .bind(
        quote.id,
        quote.quote_number ?? null,
        quote.local_quote_id ?? null,
        JSON.stringify(quote),
        quote.updated_date ?? quote.updated_at ?? receivedAt,
        receivedAt
      )
      .run();
  }
  return { duplicate: false };
}

async function getSnapshot(db) {
  const { results } = await db
    .prepare("SELECT payload, updated_at FROM quotes ORDER BY updated_at DESC")
    .all();
  return results.map((r) => ({ ...JSON.parse(r.payload), _synced_at: r.updated_at }));
}

async function getSnapshotMeta(db) {
  const row = await db
    .prepare("SELECT updated_at FROM quotes ORDER BY updated_at DESC LIMIT 1")
    .first();
  return row ? row.updated_at : null;
}

async function markOutboundStatus(db, itemId, status, extra = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const values = [status, new Date().toISOString()];
  if (extra.conflictWith !== undefined) {
    sets.push("conflict_with = ?");
    values.push(extra.conflictWith);
  }
  if (extra.remoteId !== undefined) {
    sets.push("remote_id = ?");
    values.push(extra.remoteId);
  }
  if (extra.errorMessage !== undefined) {
    sets.push("error_message = ?");
    values.push(extra.errorMessage);
  }
  values.push(itemId);
  await db.prepare(`UPDATE outbound_items SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

/**
 * Upsert an entity record into base44_entity_state.
 *
 * For `action: "delete"`:
 *   - Sets `deleted_at` timestamp (tombstone)
 *   - Uses INSERT ... ON CONFLICT DO UPDATE so deletes for never-seen records
 *     create a tombstone row instead of being silently lost
 *   - Preserves `updated_date` via COALESCE if the delete payload includes one
 *
 * For `action: "create"` or `"update"`:
 *   - Normal upsert with `deleted_at = NULL` (un-tombstones if re-created)
 *   - `updated_date` preserved via COALESCE on conflict
 */
async function upsertBase44EntityState(db, { entityType, localId, action, record, updatedDate }) {
  const now = new Date().toISOString();
  const resolvedUpdatedDate =
    updatedDate || (record && (record.updated_date || record.updated_at)) || null;

  if (action === "delete") {
    await db
      .prepare(
        `INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at, updated_date, deleted_at)
         VALUES (?, ?, 'delete', '{}', 'base44', ?, ?, ?)
         ON CONFLICT(entity_type, local_id) DO UPDATE SET
           deleted_at = ?,
           action = 'delete',
           synced_at = ?,
           updated_date = COALESCE(excluded.updated_date, base44_entity_state.updated_date)`
      )
      .bind(entityType, localId, now, resolvedUpdatedDate, now, now, now, now)
      .run();
    return;
  }

  const recordJson = record !== null && record !== undefined ? JSON.stringify(record) : "{}";
  await db
    .prepare(
      `INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at, updated_date, deleted_at)
       VALUES (?, ?, ?, ?, 'base44', ?, ?, NULL)
       ON CONFLICT(entity_type, local_id) DO UPDATE SET
         action = excluded.action,
         record_json = excluded.record_json,
         synced_at = excluded.synced_at,
         updated_date = COALESCE(excluded.updated_date, base44_entity_state.updated_date),
         deleted_at = NULL`
    )
    .bind(entityType, localId, action, recordJson, now, resolvedUpdatedDate)
    .run();
}

export {
  applyInboundEvent,
  getSnapshot,
  getSnapshotMeta,
  markOutboundStatus,
  upsertBase44EntityState,
};
