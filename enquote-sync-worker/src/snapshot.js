import { getSnapshot } from "./repository.js";
import { json } from "./util.js";

export async function handleSnapshot(request, env) {
  if (request.headers.get("Authorization") !== `Bearer ${env.SNAPSHOT_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const quotes = await getSnapshot(env.DB);
  return json({ quotes, generated_at: new Date().toISOString() });
}