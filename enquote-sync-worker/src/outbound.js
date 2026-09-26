import { recordOutboundItem, markOutboundStatus } from "./repository.js";
import { performPush } from "./pusher.js";
import { json } from "./util.js";

export async function handleEnqueue(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_body" }, 400); }

  if (!body?.entityType) return json({ error: "missing_entity_type" }, 400);

  const itemId = crypto.randomUUID();
  await recordOutboundItem(env.DB, {
    id: itemId,
    entityType: body.entityType,
    quoteId: body.quoteId || body.quote?.id,
    action: body.action || "create",
    payload: body,
  });

  try {
    const result = await performPush({ itemId, ...body }, env);
    await markOutboundStatus(env.DB, itemId, result.status, {
      conflictWith: result.conflict_with,
      remoteId: result.remote_id,
    });
    return json({ ok: true, status: result.status, remote_id: result.remote_id || null, conflict_with: result.conflict_with || null, itemId });
  } catch (err) {
    await markOutboundStatus(env.DB, itemId, "error", { errorMessage: err.message });
    if (err.retryable) {
      await env.OUTBOUND_QUEUE.send({ itemId, ...body });
      return json({ ok: false, error: err.message, queued: true, itemId });
    }
    return json({ ok: false, error: err.message, itemId });
  }
}