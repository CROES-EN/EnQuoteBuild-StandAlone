import { performPush } from "./pusher.js";
import { markBase44QuoteDeleted } from "./repository.js";
import { broadcastQuoteUpdate } from "./realtime.js";
import { refreshSnapshotCache } from "./snapshot-cache.js";
import { json } from "./util.js";

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
    if (body.entityType === "quote" && body.action === "delete") {
      await markBase44QuoteDeleted(env.DB, {
        localId: body.localId,
        remoteId: result.remote_id
      });
      try {
        const snapshot = await refreshSnapshotCache(env);
        await broadcastQuoteUpdate(env, {
          quoteCount: snapshot.quotes.length,
          lastSavedAt: snapshot.lastSavedAt
        });
      } catch (error) {
        console.error("[quote-delete] Could not refresh cached snapshot or notify connected apps:", error.message);
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
