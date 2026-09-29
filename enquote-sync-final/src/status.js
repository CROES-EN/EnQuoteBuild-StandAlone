import { json } from "./util.js";

async function handleStatus(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.OUTBOUND_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const localId = url.searchParams.get("local_id");
  if (!localId) return json({ error: "missing local_id" }, 400);
  const item = await env.DB.prepare(
    "SELECT status, remote_id, conflict_with, error_message, updated_at " +
    "FROM outbound_items WHERE json_extract(payload, '$.localId') = ? " +
    "ORDER BY created_at DESC LIMIT 1"
  ).bind(localId).first();
  if (!item) return json({ status: "unknown" });
  return json(item);
}

export { handleStatus };
