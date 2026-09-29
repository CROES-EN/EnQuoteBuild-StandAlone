import { entityUrl, authHeaders, requestJson } from "./pusher.js";

/**
 * Reconciliation handler — diffs base44_entity_state against Base44's API
 * and tombstones records that no longer exist in Base44.
 *
 * Runs automatically every 15 minutes via the cron trigger, or can be
 * triggered manually via POST /api/reconcile.
 *
 * Also cleans up enqueue_request_log entries older than 7 days.
 */
var RECONCILE_ENTITY_TYPES = ["Quote", "Product", "PVPanelRMA"];

async function handleReconcile(env) {
  const now = new Date().toISOString();
  const results = { checked: 0, tombstoned: 0, errors: 0, details: [] };

  for (const entityType of RECONCILE_ENTITY_TYPES) {
    try {
      const { results: dbRows } = await env.DB.prepare(
        "SELECT local_id FROM base44_entity_state WHERE entity_type = ? AND deleted_at IS NULL"
      ).bind(entityType).all();

      if (!dbRows || dbRows.length === 0) continue;

      const url = entityUrl(env, entityType) + "?limit=1000";
      const response = await requestJson(url, { headers: authHeaders(env) });

      if (!response.ok) {
        results.errors++;
        results.details.push({ entityType, error: `Base44 API returned ${response.status}` });
        continue;
      }

      const remoteRows = Array.isArray(response.body) ? response.body : (response.body?.items || []);
      const remoteIds = new Set(remoteRows.map((r) => String(r.id || r.local_id || r._id || "")).filter(Boolean));

      for (const row of dbRows) {
        results.checked++;
        if (!remoteIds.has(row.local_id)) {
          await env.DB.prepare(
            "UPDATE base44_entity_state SET deleted_at = ?, action = 'delete', synced_at = ? " +
            "WHERE entity_type = ? AND local_id = ? AND deleted_at IS NULL"
          ).bind(now, now, entityType, row.local_id).run();
          results.tombstoned++;
          results.details.push({ entityType, localId: row.local_id, action: "tombstoned" });
        }
      }
    } catch (err) {
      results.errors++;
      results.details.push({ entityType, error: err.message });
    }
  }

  // Clean up old enqueue_request_log entries (keep last 7 days)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("DELETE FROM enqueue_request_log WHERE received_at < ?").bind(sevenDaysAgo).run();
  } catch {}

  return results;
}

export { handleReconcile };
