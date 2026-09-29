import { upsertBase44EntityState } from "./repository.js";
import { json } from "./util.js";

/**
 * Handles POST /api/outbound/enqueue.
 *
 * - Uses `??` (nullish coalescing) instead of `||` so that `record: null`
 *   from delete payloads is respected, not treated as falsy.
 * - Extracts `updatedDate` from body (camelCase or snake_case) or record.
 * - Passes `action: "delete"` through to upsertBase44EntityState for tombstoning.
 * - Logs every request to `enqueue_request_log` with caller-identifying headers.
 */
async function handleEnqueue(request, env) {
  const userAgent = request.headers.get("User-Agent") || null;
  const cfIp = request.headers.get("CF-Connecting-IP") || null;
  const cfRay = request.headers.get("CF-Ray") || null;
  const cfCountry = request.headers.get("CF-IPCountry") || null;
  const authHeader = request.headers.get("Authorization") || null;
  const authPrefix = authHeader ? authHeader.substring(0, 20) : null;
  const url = new URL(request.url);
  const rawBodyText = await request.text();
  const bodySize = rawBodyText.length;

  let body;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    try {
      await env.DB.prepare(
        "INSERT INTO enqueue_request_log (received_at, path, method, user_agent, cf_ip, cf_ray, cf_country, auth_prefix, entity_type, action, local_id, body_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(new Date().toISOString(), url.pathname, request.method, userAgent, cfIp, cfRay, cfCountry, authPrefix, null, null, null, bodySize).run();
    } catch {}
    return json({ error: "invalid_body" }, 400);
  }

  const entityType = body?.entityType || null;
  const action = body?.action || "create";
  const localId = body.localId || body.quoteId || body.quote?.id || body.record?.id || null;

  // Use nullish coalescing (??) so record: null is respected for deletes
  const record = body.record ?? body.quote ?? (action === "delete" ? null : body);
  const updatedDate = body.updatedDate || body.updated_date || (record && (record.updated_date || record.updated_at)) || null;

  try {
    await env.DB.prepare(
      "INSERT INTO enqueue_request_log (received_at, path, method, user_agent, cf_ip, cf_ray, cf_country, auth_prefix, entity_type, action, local_id, body_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(new Date().toISOString(), url.pathname, request.method, userAgent, cfIp, cfRay, cfCountry, authPrefix, entityType, action, localId, bodySize).run();
  } catch {}

  if (!entityType) return json({ error: "missing_entity_type" }, 400);
  if (!localId) return json({ error: "missing_local_id" }, 400);

  try {
    await upsertBase44EntityState(env.DB, { entityType, localId, action, record, updatedDate });
    return json({ ok: true, stored: true, action });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export { handleEnqueue };
