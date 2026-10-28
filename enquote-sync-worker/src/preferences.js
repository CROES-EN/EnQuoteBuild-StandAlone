import { broadcastMessage } from "./realtime.js";
import { validateStamp } from "./tasks.js";
import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";

// Personal settings/customization (theme, sidebar, column layouts...) follow the signed-in
// user between the desktop app and the browser. Each preference is one key; the newest
// updatedAt wins, and deletions keep a tombstone so an older copy cannot bring them back.
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_VALUE_LENGTH = 64 * 1024;
const MAX_ENTRIES_PER_REQUEST = 100;
const MAX_KEYS_PER_USER = 400;

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "invalid_entry";
  if (typeof entry.key !== "string" || !KEY_PATTERN.test(entry.key)) return "invalid_key";
  const stampError = validateStamp(entry.updatedAt);
  if (stampError) return stampError;
  if (entry.value !== null && typeof entry.value !== "string") return "invalid_value";
  if (typeof entry.value === "string" && entry.value.length > MAX_VALUE_LENGTH) return "value_too_large";
  return null;
}

export async function handlePreferencesList(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const since = new URL(request.url).searchParams.get("since") || "";
  if (since && validateStamp(since)) return json({ ok: false, error: "invalid_since" }, 400);
  const { results } = await env.DB.prepare(`
    SELECT key, updated_at AS updatedAt, synced_at AS syncedAt, deleted, value
    FROM user_preferences
    WHERE owner = ? AND synced_at > ?
    ORDER BY synced_at
  `).bind(user.email, since).all();
  let cursor = since;
  const preferences = (results || []).map((row) => {
    if (row.syncedAt > cursor) cursor = row.syncedAt;
    return { key: row.key, updatedAt: row.updatedAt, deleted: Boolean(row.deleted), value: row.deleted ? null : row.value };
  });
  return json({ ok: true, preferences, cursor }, 200, { "Cache-Control": "no-store" });
}

export async function handlePreferencesUpsert(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const entries = body?.entries;
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ENTRIES_PER_REQUEST) {
    return json({ ok: false, error: "invalid_entries" }, 400);
  }
  const seen = new Set();
  for (const entry of entries) {
    const error = validateEntry(entry);
    if (error) return json({ ok: false, error, key: typeof entry?.key === "string" ? entry.key.slice(0, 160) : undefined }, 400);
    if (seen.has(entry.key)) return json({ ok: false, error: "duplicate_key", key: entry.key }, 400);
    seen.add(entry.key);
  }
  const { results: existing } = await env.DB.prepare("SELECT key FROM user_preferences WHERE owner = ?").bind(user.email).all();
  const known = new Set((existing || []).map((row) => row.key));
  const added = entries.filter((entry) => !known.has(entry.key)).length;
  if (known.size + added > MAX_KEYS_PER_USER) return json({ ok: false, error: "too_many_preferences" }, 413);

  const syncedAt = new Date().toISOString();
  const results = await env.DB.batch(entries.map((entry) => env.DB.prepare(`
    INSERT INTO user_preferences (owner, key, updated_at, synced_at, deleted, value)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner, key) DO UPDATE SET
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at,
      deleted = excluded.deleted,
      value = excluded.value
    WHERE excluded.updated_at > user_preferences.updated_at
  `).bind(user.email, entry.key, entry.updatedAt, syncedAt, entry.value === null ? 1 : 0, entry.value)));
  const applied = entries.filter((_entry, index) => Number(results[index]?.meta?.changes || 0) > 0).map((entry) => entry.key);
  if (applied.length) {
    try {
      await broadcastMessage(env, { type: "preferences_updated", key: user.inboxKey });
    } catch (error) {
      console.warn("[preferences] Realtime notification failed:", error.message);
    }
  }
  return json({ ok: true, applied });
}
