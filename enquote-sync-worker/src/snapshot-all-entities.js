import { getSnapshot } from "./repository.js";
import { ENTITY_COLLECTIONS } from "../../shared/entityCollections.js";
import { json } from "./util.js";

const SNAPSHOT_KEY = "snapshot:all-v6";

function checkAuth(request, env) {
  return Boolean(env.SNAPSHOT_TOKEN) && (
    request.headers.get("X-ENQuote-Shared-Secret") === env.SNAPSHOT_TOKEN ||
    request.headers.get("Authorization") === `Bearer ${env.SNAPSHOT_TOKEN}`
  );
}

export async function snapshotVersion(db) {
  const row = await db.prepare(`
    SELECT (SELECT MAX(synced_at) FROM base44_entity_state) AS entity_stamp,
           (SELECT COUNT(*) FROM base44_entity_state) AS entity_count,
           (SELECT MAX(updated_at) FROM quotes) AS quote_stamp,
           (SELECT COUNT(*) FROM quotes) AS quote_count,
           (SELECT MAX(received_at) FROM webhook_events) AS event_stamp
  `).first();
  const stamps = [row?.entity_stamp, row?.quote_stamp, row?.event_stamp].filter(Boolean).sort();
  return { version: JSON.stringify(row), lastSavedAt: stamps.at(-1) || null };
}

export async function buildSnapshotAllEntities(env) {
  const current = await snapshotVersion(env.DB);
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(SNAPSHOT_KEY, { type: "json" });
      if (cached?.version === current.version) return cached;
    } catch (error) {
      console.warn("[snapshot] Cache read failed:", error.message);
    }
  }
  const grouped = {};
  const deletedQuotes = new Set();
  for (let offset = 0; ; offset += 100) {
    const { results } = await env.DB.prepare(`
      SELECT entity_type, local_id, action, record_json, synced_at
      FROM base44_entity_state ORDER BY entity_type, local_id LIMIT 100 OFFSET ?
    `).bind(offset).all();
    for (const row of results || []) {
      // Lowercase "quote" rows are stale pre-Base44 copies from the retired desktop enqueue
      // path; desktop apps ignore them, so the shared snapshot must too.
      if (row.entity_type === "quote") continue;
      const type = row.entity_type;
      if (row.action === "delete") {
        if (type === "Quote") deletedQuotes.add(String(row.local_id));
        continue;
      }
      let record;
      try {
        record = JSON.parse(row.record_json);
        if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("not an object");
      } catch (error) {
        console.error("[snapshot] Invalid entity:", type, row.local_id, error.message);
        throw new Error(`Invalid stored ${type} record.`);
      }
      delete record._rev;
      (grouped[type] ||= []).push({ ...record, id: record.id || row.local_id, _synced_at: row.synced_at });
    }
    if ((results || []).length < 100) break;
  }
  const byId = new Map((await getSnapshot(env.DB)).map(record => {
    delete record._rev;
    return [String(record.id), record];
  }));
  for (const record of grouped.Quote || []) {
    const id = String(record.id);
    const existing = byId.get(id);
    const stamp = item => Date.parse(item?.updated_date || item?.updated_at || item?._synced_at || "") || 0;
    if (!existing || stamp(record) >= stamp(existing)) byId.set(id, record);
  }
  for (const id of deletedQuotes) byId.delete(id);
  grouped.Quote = [...byId.values()];
  const snapshot = { ok: true, ...current, generated_at: new Date().toISOString(), entities: grouped };
  for (const [type, collection] of Object.entries(ENTITY_COLLECTIONS)) {
    snapshot[collection] = grouped[type] || [];
  }
  if (env.CACHE) {
    try {
      await env.CACHE.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 86400 });
    } catch (error) {
      console.warn("[snapshot] Cache write failed:", error.message);
    }
  }
  return snapshot;
}

export async function handleSnapshotMeta(request, env) {
  if (!checkAuth(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  return json({ ok: true, ...await snapshotVersion(env.DB) }, 200, { "Cache-Control": "no-store" });
}

export async function handleSnapshot(request, env) {
  if (!checkAuth(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  return json(await buildSnapshotAllEntities(env), 200, { "Cache-Control": "no-store" });
}
