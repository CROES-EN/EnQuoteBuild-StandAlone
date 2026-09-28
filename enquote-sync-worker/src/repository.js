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