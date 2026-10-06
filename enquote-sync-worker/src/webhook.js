import { verifySignature, decryptPayload } from "./crypto.js";
import { applyInboundEvent } from "./repository.js";
import { broadcastQuoteUpdate } from "./realtime.js";
import { json } from "./util.js";

// POST /api/base44/webhook
// Base44 sends a full snapshot in each webhook — all entities at once.
export async function handleWebhook(request, env) {
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

  // The quote cache revalidates itself on read, so only real changes need to wake the apps.
  if (!result.duplicate && result.changed > 0) {
    try {
      await broadcastQuoteUpdate(env, {
        quoteCount: quotes.length,
        lastSavedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("[realtime] Could not broadcast the quote update:", error.message);
    }
  }

  return json({ ok: true, duplicate: result.duplicate, quotes: quotes.length, changed: result.changed ?? 0 });
}