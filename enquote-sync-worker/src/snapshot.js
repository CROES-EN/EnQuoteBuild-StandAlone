import { readSnapshotCache } from "./snapshot-cache.js";
import { json } from "./util.js";

export async function handleSnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({error: "unauthorized"}, 401);
  }
  const snapshot = await readSnapshotCache(env);
  return json({ quotes: snapshot.quotes, generated_at: new Date().toISOString() });
}