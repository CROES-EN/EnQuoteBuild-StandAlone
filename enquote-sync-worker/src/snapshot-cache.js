import { getSnapshot, getSnapshotMeta } from "./repository.js";

const SNAPSHOT_CACHE_KEY = "quote-snapshot-v1";
const SNAPSHOT_CACHE_TTL_SECONDS = 60;

async function writeSnapshotCache(env, snapshot) {
  if (!env.CACHE) return;
  try {
    await env.CACHE.put(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot), {
      expirationTtl: SNAPSHOT_CACHE_TTL_SECONDS
    });
  } catch (error) {
    console.warn("[snapshot-cache] KV write failed; D1 remains authoritative:", error.message);
  }
}

export async function refreshSnapshotCache(env) {
  const [quotes, lastSavedAt] = await Promise.all([
    getSnapshot(env.DB),
    getSnapshotMeta(env.DB)
  ]);
  const snapshot = { quotes, lastSavedAt };
  await writeSnapshotCache(env, snapshot);
  return snapshot;
}

export async function readSnapshotCache(env) {
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(SNAPSHOT_CACHE_KEY, { type: "json" });
      if (cached && Array.isArray(cached.quotes)) return cached;
    } catch (error) {
      console.warn("[snapshot-cache] KV read failed; falling back to D1:", error.message);
    }
  }
  return refreshSnapshotCache(env);
}
