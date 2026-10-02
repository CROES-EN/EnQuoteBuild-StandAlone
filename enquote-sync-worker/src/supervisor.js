import { json } from "./util.js";
import { broadcastMessage } from "./realtime.js";

// Shared store for the Supervisor Dashboard's imported data, so every signed-in manager
// sees the same records. Last-writer-wins per record, ordered by the client-supplied
// `updatedAt` stamp (the record's own updated_date). Deletes leave a tombstone so they
// propagate to machines that still hold the record.
const COLLECTIONS = new Set(["supervisorDailyMetrics", "supervisorReportTables"]);

// D1 caps a single row at 2 MB, and large report tables (e.g. Workload) exceed 1 MB, so each
// record's JSON is split across several chunk rows.
const CHUNK_SIZE = 250_000;
const MAX_RECORD_CHARS = 8_000_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

function isAllowedEmail(email, env) {
  const allowed = String(env.ALLOWED_EMAILS_LIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email);
}

async function readPayload(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validateKey(collection, id) {
  if (!COLLECTIONS.has(collection)) return "unsupported_collection";
  if (typeof id !== "string" || !id || id.length > 200) return "invalid_id";
  return null;
}

function validateStamp(stamp) {
  if (typeof stamp !== "string" || !STAMP_PATTERN.test(stamp) || !Number.isFinite(Date.parse(stamp))) {
    return "invalid_stamp";
  }
  if (Date.parse(stamp) > Date.now() + MAX_FUTURE_SKEW_MS) return "stamp_in_future";
  return null;
}

export function splitIntoChunks(text, size = CHUNK_SIZE) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    // Never split a surrogate pair across two rows.
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function readIdentity(request, env) {
  const body = await readPayload(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !isAllowedEmail(email, env)) return { error: json({ ok: false, error: "email_not_allowed" }, 403) };
  return { body, email };
}

async function applyChange(env, { collection, id, stamp, email, deleted, chunks }) {
  const statements = [];
  for (let index = 0; index < chunks.length; index += 1) {
    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO supervisor_record_chunks (collection, id, version, chunk_index, data)
        VALUES (?, ?, ?, ?, ?)
      `).bind(collection, id, stamp, index, chunks[index])
    );
  }
  statements.push(
    env.DB.prepare(`
      INSERT INTO supervisor_records (collection, id, updated_at, deleted, chunk_count, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        chunk_count = excluded.chunk_count,
        updated_by = excluded.updated_by
      WHERE excluded.updated_at > supervisor_records.updated_at
    `).bind(collection, id, stamp, deleted ? 1 : 0, chunks.length, email)
  );
  const metaIndex = statements.length - 1;
  // Drops every chunk that doesn't belong to the winning version - including the chunks just
  // inserted above when this write lost to a newer one.
  statements.push(
    env.DB.prepare(`
      DELETE FROM supervisor_record_chunks
      WHERE collection = ? AND id = ?
        AND version != (SELECT updated_at FROM supervisor_records WHERE collection = ? AND id = ?)
    `).bind(collection, id, collection, id)
  );
  const results = await env.DB.batch(statements);
  return Number(results[metaIndex]?.meta?.changes || 0) > 0;
}

export async function handleSupervisorIndex(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare(`
    SELECT collection, id, updated_at AS updatedAt, deleted, updated_by AS updatedBy
    FROM supervisor_records
    ORDER BY collection, id
  `).all();
  return json({
    ok: true,
    records: (results || []).map((row) => ({ ...row, deleted: Boolean(row.deleted) }))
  });
}

export async function handleSupervisorRecord(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const collection = url.searchParams.get("collection") || "";
  const id = url.searchParams.get("id") || "";
  const keyError = validateKey(collection, id);
  if (keyError) return json({ ok: false, error: keyError }, 400);

  // One batch = one consistent read, so a concurrent write can't mix two versions' chunks.
  const [metaResult, chunkResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT updated_at AS updatedAt, deleted FROM supervisor_records WHERE collection = ? AND id = ?
    `).bind(collection, id),
    env.DB.prepare(`
      SELECT data FROM supervisor_record_chunks
      WHERE collection = ? AND id = ?
        AND version = (SELECT updated_at FROM supervisor_records WHERE collection = ? AND id = ?)
      ORDER BY chunk_index
    `).bind(collection, id, collection, id)
  ]);
  const meta = metaResult.results?.[0];
  if (!meta) return json({ ok: false, error: "not_found" }, 404);
  if (meta.deleted) return json({ ok: true, updatedAt: meta.updatedAt, deleted: true, record: null });

  const text = (chunkResult.results || []).map((row) => row.data).join("");
  try {
    return json({ ok: true, updatedAt: meta.updatedAt, deleted: false, record: JSON.parse(text) });
  } catch {
    return json({ ok: false, error: "corrupt_record" }, 500);
  }
}

export async function handleSupervisorUpsert(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const identity = await readIdentity(request, env);
  if (identity.error) return identity.error;
  const { body, email } = identity;

  const { collection, id, updatedAt, record } = body;
  const keyError = validateKey(collection, id) ||
    validateStamp(updatedAt) ||
    (record && typeof record === "object" && !Array.isArray(record) ? null : "invalid_record");
  if (keyError) return json({ ok: false, error: keyError }, 400);

  const text = JSON.stringify(record);
  if (text.length > MAX_RECORD_CHARS) return json({ ok: false, error: "record_too_large" }, 413);

  const applied = await applyChange(env, {
    collection, id, stamp: updatedAt, email, deleted: false, chunks: splitIntoChunks(text)
  });
  if (applied) await notify(env, { collection, id, deleted: false });
  return json({ ok: true, applied });
}

export async function handleSupervisorDelete(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const identity = await readIdentity(request, env);
  if (identity.error) return identity.error;
  const { body, email } = identity;

  const { collection, id, deletedAt } = body;
  const keyError = validateKey(collection, id) || validateStamp(deletedAt);
  if (keyError) return json({ ok: false, error: keyError }, 400);

  const applied = await applyChange(env, { collection, id, stamp: deletedAt, email, deleted: true, chunks: [] });
  if (applied) await notify(env, { collection, id, deleted: true });
  return json({ ok: true, applied });
}

async function notify(env, data) {
  try {
    await broadcastMessage(env, { type: "supervisor_updated", ...data });
  } catch (error) {
    console.warn("[supervisor] Realtime notification failed; clients will catch up on their next poll:", error.message);
  }
}
