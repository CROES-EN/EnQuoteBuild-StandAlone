import { json } from "./util.js";

// Stage 2: lets the desktop app read every Base44-originated entity change
// stored by /api/outbound/enqueue (see outbound.js's upsertBase44EntityState
// and repository.js). This is how a Product/MaterialOrder/QuoteAlert/etc.
// edit made directly in Base44 makes its way down into the desktop app -
// mirroring the existing /api/base44/webhook/snapshot pattern already used
// for quotes, but reading from base44_entity_state instead of the quotes
// table.
export async function handleEntitySnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const { results } = await env.DB
    .prepare(
      "SELECT entity_type, local_id, action, record_json, synced_at FROM base44_entity_state ORDER BY synced_at DESC"
    )
    .all();

  const entities = (results || []).map((row) => {
    let record = {};
    try {
      record = JSON.parse(row.record_json);
    } catch {
      record = {};
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
