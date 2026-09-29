import { upsertBase44EntityState } from "./repository.js";
import { json } from "./util.js";

/**
 * === CHANGE 3: handleEnqueue now passes updated_date through to upsertBase44EntityState ===
 *
 * Extracts updated_date from the request body in any of these locations:
 *   - body.updatedDate (camelCase)
 *   - body.updated_date (snake_case)
 *   - body.record.updated_date (inside the record object)
 *   - body.record.updated_at (fallback inside record)
 *
 * Passes it to upsertBase44EntityState which stores it in the dedicated D1 column.
 */
async function handleEnqueue(request, env) {
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

  const localId = body.localId || body.quoteId || body.quote?.id || body.record?.id;
  if (!localId) return json({ error: "missing_local_id" }, 400);

  const record = body.record || body.quote || body;
  const updatedDate =
    body.updatedDate || body.updated_date || record?.updated_date || record?.updated_at || null;

  try {
    await upsertBase44EntityState(env.DB, {
      entityType: body.entityType,
      localId,
      action: body.action || "create",
      record,
      updatedDate,
    });
    return json({ ok: true, stored: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export { handleEnqueue };
