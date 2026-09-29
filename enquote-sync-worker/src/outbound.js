import { upsertBase44EntityState } from "./repository.js";
import { json } from "./util.js";

// Stage 1 fix (confirmed with Base44, see project chat log): this endpoint is
// now D1-ONLY for every entity type, including Quote. It NEVER calls Base44's
// own API - that was causing a self-triggering loop where a Base44-originated
// edit got pushed back into Base44 via performPush(), which Base44 then saw
// as a brand new change and re-triggered the same workflow indefinitely.
//
// The opposite direction (EnQuote desktop -> Base44) will be handled by a
// separate route, /api/inbound/base44 (Stage 2 - not built yet). Until that
// exists, desktop-originated quote pushes to Base44's API are paused; quotes
// created/edited on the desktop are still safely queued locally (see
// electron/outboundSync.cjs's existing local queue) and will sync once
// Stage 2 is in place.
export async function handleEnqueue(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_body" }, 400); }

  if (!body?.entityType) return json({ error: "missing_entity_type" }, 400);

  const localId = body.localId || body.quoteId || body.quote?.id || body.record?.id;
  if (!localId) return json({ error: "missing_local_id" }, 400);

  try {
    await upsertBase44EntityState(env.DB, {
      entityType: body.entityType,
      localId,
      action: body.action || "create",
      record: body.record || body.quote || body,
    });
    return json({ ok: true, stored: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}