import { getSnapshot, getSnapshotMeta } from "./repository.js";
import { json } from "./util.js";

async function handleSnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const quotes = await getSnapshot(env.DB);
  return json({ quotes, generated_at: new Date().toISOString() });
}

async function handleSnapshotMeta(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const lastSavedAt = await getSnapshotMeta(env.DB);
  return json({ ok: true, lastSavedAt });
}

export { handleSnapshot, handleSnapshotMeta };
