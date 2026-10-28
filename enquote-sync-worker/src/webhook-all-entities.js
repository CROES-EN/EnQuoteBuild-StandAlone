import { verifySignature, decryptPayload } from "./crypto.js";
import { applyInboundEvent } from "./repository.js";
import { broadcastMessage } from "./realtime.js";
import { json } from "./util.js";

export async function handleWebhook(request, env) {
  const rawBody = await request.arrayBuffer();
  if (!await verifySignature(env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET, rawBody, request.headers.get("X-ENQuote-Signature"))) {
    return json({ error: "invalid_signature" }, 401);
  }
  let envelope, payload;
  try {
    envelope = JSON.parse(new TextDecoder().decode(rawBody));
    payload = await decryptPayload(env.ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY, envelope);
  } catch (error) {
    console.warn("[webhook] Invalid encrypted payload:", error.message);
    return json({ error: "invalid_payload" }, 400);
  }
  const eventId = payload.delivery_id || envelope.delivery_id;
  if (!eventId) return json({ error: "missing_delivery_id" }, 400);
  const existing = await env.DB.prepare("SELECT event_id FROM webhook_events WHERE event_id = ?").bind(eventId).first();
  if (existing) return json({ ok: true, duplicate: true });

  const entities = payload.snapshot?.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    return json({ error: "invalid_entities" }, 400);
  }
  const stamp = new Date().toISOString();
  const statements = [];
  for (const [entityType, records] of Object.entries(entities)) {
    if (!Array.isArray(records)) return json({ error: "invalid_entity_records" }, 400);
    for (const record of records) {
      const id = record?.id || record?._id || record?.local_id;
      if (!id) return json({ error: "missing_entity_id", entityType }, 400);
      statements.push(env.DB.prepare(`
        INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
        VALUES (?, ?, 'update', ?, 'base44', ?)
        ON CONFLICT(entity_type, local_id) DO UPDATE SET
          action = excluded.action, record_json = excluded.record_json, synced_at = excluded.synced_at
        WHERE base44_entity_state.action != 'delete'
          AND base44_entity_state.record_json IS NOT excluded.record_json
          AND COALESCE(json_extract(excluded.record_json, '$.updated_date'), '') >=
              COALESCE(json_extract(base44_entity_state.record_json, '$.updated_date'), '')
      `).bind(entityType, String(id), JSON.stringify(record), stamp));
    }
  }
  const deletions = payload.snapshot?.deletions || payload.deletions || {};
  for (const [entityType, ids] of Object.entries(deletions)) {
    if (!Array.isArray(ids)) return json({ error: "invalid_deletions" }, 400);
    for (const id of ids) {
      statements.push(env.DB.prepare(`
        INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
        VALUES (?, ?, 'delete', '{}', 'base44', ?)
        ON CONFLICT(entity_type, local_id) DO UPDATE SET
          action = 'delete', record_json = '{}', synced_at = excluded.synced_at
      `).bind(entityType, String(id), stamp));
      if (entityType === "Quote") statements.push(env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(String(id)));
    }
  }
  let changed = 0;
  for (let offset = 0; offset < statements.length; offset += 80) {
    const results = await env.DB.batch(statements.slice(offset, offset + 80));
    changed += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  }
  // Only acknowledge the delivery after every entity has been stored. Retrying partial writes is idempotent.
  const deleted = new Set(deletions.Quote || []);
  const result = await applyInboundEvent(env.DB, {
    id: eventId, quotes: (entities.Quote || []).filter(record => !deleted.has(record.id))
  });
  if (changed || result.changed) await broadcastMessage(env, { type: "entities_updated", lastSavedAt: stamp });
  return json({ ok: true, duplicate: result.duplicate, changed, quotes: (entities.Quote || []).length });
}
