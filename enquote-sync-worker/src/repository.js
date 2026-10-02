// All storage access lives here. Handlers never touch SQL directly.

export async function applyInboundEvent(db, event) {
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

export async function getSnapshot(db) {
  const { results } = await db
    .prepare("SELECT payload, updated_at FROM quotes ORDER BY updated_at DESC")
    .all();
  return results.map((r) => ({ ...JSON.parse(r.payload), _synced_at: r.updated_at }));
}
export async function getSnapshotMeta(db) {
  const row = await db
      .prepare("SELECT updated_at FROM quotes ORDER BY updated_at DESC LIMIT 1")
      .first();
  return row ? row.updated_at : null;
}


export async function recordOutboundItem(db, { id, entityType, quoteId, action, payload }) {
  await db
    .prepare(
      "INSERT INTO outbound_items (id, entity_type, quote_id, action, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)"
    )
    .bind(id, entityType, quoteId ?? null, action, JSON.stringify(payload), new Date().toISOString())
    .run();
}

export async function markOutboundStatus(db, itemId, status, extra = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const values = [status, new Date().toISOString()];
  if (extra.conflictWith !== undefined) { sets.push("conflict_with = ?"); values.push(extra.conflictWith); }
  if (extra.remoteId !== undefined) { sets.push("remote_id = ?"); values.push(extra.remoteId); }
  if (extra.errorMessage !== undefined) { sets.push("error_message = ?"); values.push(extra.errorMessage); }
  values.push(itemId);
  await db.prepare(`UPDATE outbound_items SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

// Stage 1 fix (confirmed with Base44): stores a Base44-originated entity
// change for the desktop app to read later, WITHOUT ever writing back to
// Base44's own API. This is what stopped the self-triggering loop where a
// Product edit in Base44 -> pushed back to Base44's API -> Base44 saw it as
// a new change -> re-triggered the same workflow, endlessly.
//
// Upserts by (entity_type, local_id) - a repeated create/update for the same
// record simply overwrites the stored copy instead of accumulating rows.
export async function upsertBase44EntityState(db, { entityType, localId, action, record }) {
  await db
    .prepare(
      `INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
       VALUES (?, ?, ?, ?, 'base44', ?)
       ON CONFLICT(entity_type, local_id) DO UPDATE SET
         action = excluded.action,
         record_json = excluded.record_json,
         synced_at = excluded.synced_at
       WHERE base44_entity_state.action != 'delete'`
    )
    .bind(entityType, localId, action, JSON.stringify(record ?? {}), new Date().toISOString())
    .run();
}

export async function markBase44QuoteDeleted(db, { localId, remoteId }) {
  const quoteId = String(remoteId || localId || "");
  if (!quoteId) throw new Error("A quote id is required to record a deletion.");
  const deletedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
       VALUES ('Quote', ?, 'delete', '{}', 'desktop', ?)
       ON CONFLICT(entity_type, local_id) DO UPDATE SET
         action = 'delete',
         record_json = '{}',
         origin = 'desktop',
         synced_at = excluded.synced_at`
    )
    .bind(quoteId, deletedAt)
    .run();
  await db.prepare("DELETE FROM quotes WHERE id = ?").bind(quoteId).run();
  if (localId && String(localId) !== quoteId) {
    await db.prepare("DELETE FROM quotes WHERE id = ?").bind(String(localId)).run();
  }
}