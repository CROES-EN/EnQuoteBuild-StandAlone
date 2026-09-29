import { json } from "./util.js";

/**
 * === CHANGE 2: handleEntitySnapshot now injects updated_date into every record ===
 *
 * Returns all entity records from base44_entity_state, with updated_date
 * guaranteed to be present on every record object.
 *
 * Fallback chain for updated_date:
 *   1. record.updated_date (already in the record JSON — best case)
 *   2. row.updated_date (from the D1 column — set by upsertBase44EntityState)
 *   3. record.updated_at (if present in record JSON)
 *   4. row.synced_at (last-resort fallback — Worker write time)
 *
 * This eliminates the class of bug where a missing timestamp field causes
 * the consumer to treat the record as stale and silently discard updates.
 */
async function handleEntitySnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const { results } = await env.DB.prepare(
    "SELECT entity_type, local_id, action, record_json, synced_at, updated_date " +
      "FROM base44_entity_state ORDER BY synced_at DESC"
  ).all();

  const entities = (results || []).map((row) => {
    let record = {};
    try {
      record = JSON.parse(row.record_json);
    } catch {
      record = {};
    }

    // Ensure updated_date is always present on the record object.
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

  return json({ ok: true, entities, generated_at: new Date().toISOString() });
}

export { handleEntitySnapshot };
