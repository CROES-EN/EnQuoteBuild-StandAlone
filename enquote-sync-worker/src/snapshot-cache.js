import { getSnapshot, getSnapshotVersion } from "./repository.js";

const SNAPSHOT_CACHE_KEY = "quote-snapshot-v2";
// The cache is checked against the live D1 version on every read, so a long TTL never serves
// stale quotes; it only keeps KV writes to one per real change instead of one per minute.
const SNAPSHOT_CACHE_TTL_SECONDS = 24 * 60 * 60;

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

async function buildSnapshot(env, current) {
  const quotes = await getSnapshot(env.DB);
  return { version: current.version, quotes, lastSavedAt: current.lastSavedAt };
}

export async function refreshSnapshotCache(env) {
  const current = await getSnapshotVersion(env.DB);
  const snapshot = await buildSnapshot(env, current);
  await writeSnapshotCache(env, snapshot);
  return snapshot;
}

export async function readSnapshotCache(env) {
  const current = await getSnapshotVersion(env.DB);
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(SNAPSHOT_CACHE_KEY, { type: "json" });
      if (cached && Array.isArray(cached.quotes) && cached.version === current.version) return cached;
    } catch (error) {
      console.warn("[snapshot-cache] KV read failed; falling back to D1:", error.message);
    }
  }
  const snapshot = await buildSnapshot(env, current);
  await writeSnapshotCache(env, snapshot);
  return snapshot;
}