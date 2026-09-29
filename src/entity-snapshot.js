import { json } from "./util.js";

/**
 * Returns all active entity records, merging two data sources:
 *
 * 1. base44_entity_state (primary) — records from the Base44 automation via
 *    /api/outbound/enqueue. Has the latest statuses and native fields.
 * 2. quotes table (fallback) — records from the encrypted webhook that were
 *    never sent through the enqueue path. These are merged in only if they
 *    don't already exist in base44_entity_state.
 *
 * Tombstoned records (deleted_at IS NOT NULL) are excluded.
 *
 * updated_date is guaranteed on every record via fallback chain:
 *   1. record.updated_date (in record JSON)
 *   2. row.updated_date (D1 column)
 *   3. record.updated_at (in record JSON)
 *   4. row.synced_at (last-resort)
 */
async function handleEntitySnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  // 1. Get all active records from base44_entity_state (primary source)
  const { results: entityRows } = await env.DB.prepare(
    "SELECT entity_type, local_id, action, record_json, synced_at, updated_date, deleted_at " +
    "FROM base44_entity_state WHERE deleted_at IS NULL ORDER BY synced_at DESC"
  ).all();

  const entities = (entityRows || []).map((row) => {
    let record = {};
    try { record = JSON.parse(row.record_json); } catch { record = {}; }
    if (!record.updated_date) {
      record.updated_date = row.updated_date || record.updated_at || row.synced_at;
    }
    return {
      entityType: row.entity_type,
      localId: row.local_id,
      action: row.action,
      record,
      syncedAt: row.synced_at,
    };
  });

  // 2. Build a set of Quote IDs already in base44_entity_state
  const existingQuoteIds = new Set(
    entities.filter((e) => e.entityType === "Quote").map((e) => e.localId)
  );

  // 3. Get Quote records from the quotes table that are NOT in base44_entity_state
  //    These arrived via the webhook but were never sent through enqueue
  const { results: quotesRows } = await env.DB.prepare(
    "SELECT id, payload, updated_at FROM quotes ORDER BY updated_at DESC"
  ).all();

  for (const qRow of (quotesRows || [])) {
    const quoteId = qRow.id;
    if (existingQuoteIds.has(quoteId)) continue; // already in entity-snapshot, skip

    let record = {};
    try { record = JSON.parse(qRow.payload); } catch { record = {}; }

    // Ensure updated_date is present (quotes table has it from the webhook)
    if (!record.updated_date) {
      record.updated_date = record.updated_at || qRow.updated_at;
    }

    entities.push({
      entityType: "Quote",
      localId: quoteId,
      action: "create",
      record,
      syncedAt: qRow.updated_at,
    });
  }

  return json({ ok: true, entities, generated_at: new Date().toISOString() });
}

export { handleEntitySnapshot };
