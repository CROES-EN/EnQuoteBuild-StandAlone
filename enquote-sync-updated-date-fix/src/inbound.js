import { performPush } from "./pusher.js";
import { json } from "./util.js";

async function handleInboundBase44(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!body?.entityType) return json({ error: "missing_entity_type" }, 400);

  try {
    const result = await performPush(body, env);
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

export { handleInboundBase44 };
