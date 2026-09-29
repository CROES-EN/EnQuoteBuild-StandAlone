import { verifySignature, decryptPayload } from "./crypto.js";
import { applyInboundEvent } from "./repository.js";
import { json } from "./util.js";

async function handleWebhook(request, env) {
  const rawBody = await request.arrayBuffer();
  const valid = await verifySignature(
    env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET,
    rawBody,
    request.headers.get("X-ENQuote-Signature")
  );
  if (!valid) return json({ error: "invalid_signature" }, 401);

  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  let payload;
  try {
    payload = await decryptPayload(env.ENQUOTE_LOCAL_SYNC_ENCRYPTION_KEY, envelope);
  } catch (err) {
    return json({ error: "decryption_failed", detail: err.message }, 400);
  }

  const eventId = payload.delivery_id || envelope.delivery_id;
  if (!eventId) return json({ error: "missing_delivery_id" }, 400);

  const quotes = payload.snapshot?.entities?.Quote ?? [];
  const result = await applyInboundEvent(env.DB, { id: eventId, quotes });
  return json({ ok: true, duplicate: result.duplicate, quotes: quotes.length });
}

export { handleWebhook };
