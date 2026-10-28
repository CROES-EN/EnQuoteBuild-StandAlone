import { performPush } from "./pusher.js";
import { getSnapshotMeta, markBase44QuoteDeleted } from "./repository.js";
import { broadcastMessage, broadcastQuoteUpdate } from "./realtime.js";
import { ENTITY_COLLECTIONS } from "../../shared/entityCollections.js";
import { json } from "./util.js";

const GENERIC_SYNCED_ENTITIES = new Set(Object.keys(ENTITY_COLLECTIONS)
  .filter(type => !["Quote", "User", "Product"].includes(type)));

// Desktop edits to shared collections are stored under their Base44 id immediately, so
// browsers see them without waiting for Base44's webhook to echo the change back.
async function recordGenericEntityState(env, body, remoteId) {
  const stamp = new Date().toISOString();
  const record = body.action === "delete" ? {} : { ...body.record, id: remoteId, updated_date: body.record?.updated_date || stamp };
  for (const key of ["_rev", "_synced_at", "base44_id", "base44_synced_at"]) delete record[key];
  await env.DB.prepare(`
    INSERT INTO base44_entity_state (entity_type, local_id, action, record_json, origin, synced_at)
    VALUES (?, ?, ?, ?, 'desktop', ?)
    ON CONFLICT(entity_type, local_id) DO UPDATE SET
      action = excluded.action, record_json = excluded.record_json,
      origin = excluded.origin, synced_at = excluded.synced_at
    WHERE base44_entity_state.action != 'delete'
  `).bind(body.entityType, remoteId, body.action === "delete" ? "delete" : body.action === "update" ? "update" : "create",
    JSON.stringify(record), stamp).run();
  try {
    await broadcastMessage(env, { type: "entities_updated", entityType: body.entityType, lastSavedAt: stamp });
  } catch (error) {
    console.warn("[inbound] Could not notify connected apps:", error.message);
  }
}

// Stage 2: Desktop -> Base44 ONLY. This is the counterpart to
// /api/outbound/enqueue (which, since Stage 1, is Base44 -> D1 only - see
// outbound.js). This route is now the ONLY place in the Worker that ever
// writes back into Base44's own API. Keeping these two directions on
// physically separate routes is what prevents the self-triggering loop
// discovered earlier (a Base44-originated change getting written back to
// Base44 and re-triggering itself).
//
// Reuses the existing performPush()/pushCreate()/pushUpdate() logic in
// pusher.js unchanged - that logic was already correct, it just needed to be
// reachable from a route that ONLY receives genuine desktop-originated
// writes, never Base44-originated ones.
export async function handleInboundBase44(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_body" }, 400); }

  if (!body?.entityType) return json({ error: "missing_entity_type" }, 400);

  try {
    const result = await performPush(body, env);
    if (GENERIC_SYNCED_ENTITIES.has(body.entityType) && result.remote_id) {
      await recordGenericEntityState(env, body, String(result.remote_id));
    }
    if (body.entityType === "quote" && body.action === "delete") {
      await markBase44QuoteDeleted(env.DB, {
        localId: body.localId,
        remoteId: result.remote_id
      });
      try {
        await broadcastQuoteUpdate(env, {
          lastSavedAt: await getSnapshotMeta(env.DB)
        });
      } catch (error) {
        console.error("[quote-delete] Could not notify connected apps:", error.message);
      }
    }
    return json({
      ok: true,
      status: result.status,
      remote_id: result.remote_id || null,
      conflict_with: result.conflict_with || null,
    });
  } catch (err) {
    return json({ ok: false, error: err.message, retryable: Boolean(err.retryable) });
  }
}
