import { broadcastMessage } from "./realtime.js";
import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validateStamp(stamp) {
  if (typeof stamp !== "string" || !STAMP_PATTERN.test(stamp) || !Number.isFinite(Date.parse(stamp))) return "invalid_stamp";
  if (Date.parse(stamp) > Date.now() + MAX_FUTURE_SKEW_MS) return "stamp_in_future";
  return null;
}

function validateSince(since) {
  if (!since) return null;
  return validateStamp(since);
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

function parseRecord(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function notify(env, key) {
  try { await broadcastMessage(env, { type: "tasks_updated", key }); } catch (error) {
    console.warn("[tasks] Realtime notification failed:", error.message);
  }
}

export async function handleTasksList(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const since = new URL(request.url).searchParams.get("since") || "";
  const stampError = validateSince(since);
  if (stampError) return json({ ok: false, error: stampError }, 400);
  const { results } = await env.DB.prepare(`
    SELECT id, updated_at AS updatedAt, synced_at AS syncedAt, deleted, data
    FROM user_tasks
    WHERE owner = ? AND synced_at > ?
    ORDER BY synced_at
  `).bind(user.email, since).all();
  let cursor = since;
  const tasks = (results || []).map((row) => {
    if (!cursor || row.syncedAt > cursor) cursor = row.syncedAt;
    return { id: row.id, updatedAt: row.updatedAt, deleted: Boolean(row.deleted), record: row.deleted ? null : parseRecord(row.data) };
  });
  return json({ ok: true, tasks, cursor });
}

export async function handleTasksUpsert(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const { id, updatedAt, record } = body || {};
  const keyError = (typeof id !== "string" || !id || id.length > 100 ? "invalid_id" : null) ||
    validateStamp(updatedAt) ||
    (record && typeof record === "object" && !Array.isArray(record) ? null : "invalid_record");
  if (keyError) return json({ ok: false, error: keyError }, 400);
  const text = JSON.stringify(record);
  if (text.length > 50_000) return json({ ok: false, error: "record_too_large" }, 413);
  const syncedAt = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO user_tasks (owner, id, updated_at, synced_at, deleted, data)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(owner, id) DO UPDATE SET
        updated_at = excluded.updated_at,
        synced_at = excluded.synced_at,
        deleted = 0,
        data = excluded.data
      WHERE excluded.updated_at > user_tasks.updated_at
    `).bind(user.email, id, updatedAt, syncedAt, text)
  ]);
  const applied = Number(result?.meta?.changes || 0) > 0;
  if (applied) await notify(env, user.inboxKey);
  return json({ ok: true, applied });
}

export async function handleTasksDelete(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const { id, deletedAt } = body || {};
  const keyError = (typeof id !== "string" || !id || id.length > 100 ? "invalid_id" : null) || validateStamp(deletedAt);
  if (keyError) return json({ ok: false, error: keyError }, 400);
  const syncedAt = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO user_tasks (owner, id, updated_at, synced_at, deleted, data)
      VALUES (?, ?, ?, ?, 1, NULL)
      ON CONFLICT(owner, id) DO UPDATE SET
        updated_at = excluded.updated_at,
        synced_at = excluded.synced_at,
        deleted = 1,
        data = NULL
      WHERE excluded.updated_at > user_tasks.updated_at
    `).bind(user.email, id, deletedAt, syncedAt)
  ]);
  const applied = Number(result?.meta?.changes || 0) > 0;
  if (applied) await notify(env, user.inboxKey);
  return json({ ok: true, applied });
}

export { validateStamp, parseRecord };
