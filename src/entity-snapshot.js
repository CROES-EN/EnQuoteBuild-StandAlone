import { json } from "./util.js";

/**
 * Returns all active entity records from base44_entity_state.
 *
 * CHANGES:
 * - Filters out tombstoned records (WHERE deleted_at IS NULL)
 * - Injects `updated_date` into every record object using a 4-level fallback:
 *   1. record.updated_date (already in record JSON — best case)
 *   2. row.updated_date (from the D1 column)
 *   3. record.updated_at (if present in record JSON)
 *   4. row.synced_at (last-resort — Worker write time)
 */
async function handleEntitySnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const { results } = await env.DB.prepare(
    "SELECT entity_type, local_id, action, record_json, synced_at, updated_date, deleted_at " +
    "FROM base44_entity_state WHERE deleted_at IS NULL ORDER BY synced_at DESC"
  ).all();

  const entities = (results || []).map((row) => {
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

  return json({ ok: true, entities, generated_at: new Date().toISOString() });
}

export { handleEntitySnapshot };
