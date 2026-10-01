import { json } from "./util.js";

const SNAPSHOT_PAGE_SIZE = 100;

// Stage 2: lets the desktop app read every Base44-originated entity change
// stored by /api/outbound/enqueue (see outbound.js's upsertBase44EntityState
// and repository.js). This is how a Product/MaterialOrder/QuoteAlert/etc.
// edit made directly in Base44 makes its way down into the desktop app -
// mirroring the existing /api/base44/webhook/snapshot pattern already used
// for quotes, but reading from base44_entity_state instead of the quotes
// table.
export async function handleEntitySnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const entityPages = [];
  let offset = 0;
  while (true) {
    const { results } = await env.DB.prepare(`
      SELECT COUNT(*) AS row_count,
        json_group_array(json_object(
          'entityType', entity_type,
          'localId', local_id,
          'action', action,
          'record', json(CASE WHEN json_valid(record_json) THEN record_json ELSE '{}' END),
          'syncedAt', synced_at
        )) AS entities_json
      FROM (
        SELECT entity_type, local_id, action, record_json, synced_at
        FROM base44_entity_state
        ORDER BY synced_at DESC
        LIMIT ? OFFSET ?
      )
    `).bind(SNAPSHOT_PAGE_SIZE, offset).all();

    const page = results?.[0];
    const rowCount = Number(page?.row_count || 0);
    if (rowCount === 0) break;
    if (typeof page.entities_json !== "string") {
      throw new Error("Could not encode an entity snapshot page.");
    }
    entityPages.push(page.entities_json);
    offset += rowCount;
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"ok":true,"entities":['));
      let hasEntities = false;
      for (const page of entityPages) {
        const entities = page.slice(1, -1);
        if (!entities) continue;
        if (hasEntities) controller.enqueue(encoder.encode(","));
        controller.enqueue(encoder.encode(entities));
        hasEntities = true;
      }
      controller.enqueue(encoder.encode(`],"generated_at":${JSON.stringify(new Date().toISOString())}}`));
      controller.close();
    }
  });

  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
