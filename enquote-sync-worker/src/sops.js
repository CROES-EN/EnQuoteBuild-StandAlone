import { broadcastMessage } from "./realtime.js";
import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";
import { parseRecord, validateStamp } from "./tasks.js";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function notify(env, id) {
  try { await broadcastMessage(env, { type: "sops_updated", id }); } catch (error) {
    console.warn("[sops] Realtime notification failed:", error.message);
  }
}

function validateId(id) {
  return typeof id === "string" && id && id.length <= 100 ? null : "invalid_id";
}

async function writeDoc(env, { id, stamp, email, deleted, data }) {
  const syncedAt = new Date().toISOString();
  const statements = [
    env.DB.prepare(`
      INSERT INTO sop_docs (id, updated_at, synced_at, deleted, updated_by, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        synced_at = excluded.synced_at,
        deleted = excluded.deleted,
        updated_by = excluded.updated_by,
        data = excluded.data
      WHERE excluded.updated_at > sop_docs.updated_at
    `).bind(id, stamp, syncedAt, deleted ? 1 : 0, email, data),
    env.DB.prepare(`
      INSERT OR IGNORE INTO sop_versions (doc_id, version, updated_by, deleted, data)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, stamp, email, deleted ? 1 : 0, data),
    env.DB.prepare(`
      DELETE FROM sop_versions
      WHERE doc_id = ? AND version NOT IN (
        SELECT version FROM sop_versions WHERE doc_id = ? ORDER BY version DESC LIMIT 50
      )
    `).bind(id, id)
  ];
  const results = await env.DB.batch(statements);
  return Number(results[0]?.meta?.changes || 0) > 0;
}

export async function handleSopsList(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const since = new URL(request.url).searchParams.get("since") || "";
  const stampError = since ? validateStamp(since) : null;
  if (stampError) return json({ ok: false, error: stampError }, 400);
  const { results } = await env.DB.prepare(`
    SELECT id, updated_at AS updatedAt, synced_at AS syncedAt, deleted, updated_by AS updatedBy, data
    FROM sop_docs
    WHERE synced_at > ?
    ORDER BY synced_at
  `).bind(since).all();
  let cursor = since;
  const sops = (results || []).map((row) => {
    if (!cursor || row.syncedAt > cursor) cursor = row.syncedAt;
    return { id: row.id, updatedAt: row.updatedAt, deleted: Boolean(row.deleted), updatedBy: row.updatedBy, record: parseRecord(row.data) };
  });
  return json({ ok: true, sops, cursor });
}

export async function handleSopsUpsert(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const { id, updatedAt, record } = body || {};
  const keyError = validateId(id) || validateStamp(updatedAt) ||
    (record && typeof record === "object" && !Array.isArray(record) ? null : "invalid_record");
  if (keyError) return json({ ok: false, error: keyError }, 400);
  const text = JSON.stringify(record);
  if (text.length > 1_000_000) return json({ ok: false, error: "record_too_large" }, 413);
  const applied = await writeDoc(env, { id, stamp: updatedAt, email: user.email, deleted: false, data: text });
  if (applied) await notify(env, id);
  return json({ ok: true, applied });
}

export async function handleSopsDelete(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const body = await readBody(request);
  const { id, deletedAt } = body || {};
  const keyError = validateId(id) || validateStamp(deletedAt);
  if (keyError) return json({ ok: false, error: keyError }, 400);
  const current = (await env.DB.prepare("SELECT data FROM sop_docs WHERE id = ?").bind(id).all()).results?.[0];
  const applied = await writeDoc(env, { id, stamp: deletedAt, email: user.email, deleted: true, data: current?.data ?? null });
  if (applied) await notify(env, id);
  return json({ ok: true, applied });
}

export async function handleSopsVersions(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  const keyError = validateId(id);
  if (keyError) return json({ ok: false, error: keyError }, 400);
  const { results } = await env.DB.prepare(`
    SELECT version, updated_by AS updatedBy, deleted, data
    FROM sop_versions WHERE doc_id = ? ORDER BY version DESC
  `).bind(id).all();
  return json({ ok: true, versions: (results || []).map((row) => ({
    version: row.version,
    updatedBy: row.updatedBy,
    deleted: Boolean(row.deleted),
    record: parseRecord(row.data)
  })) });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleSopFileUpload(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return json({ ok: false, error: "unsupported_file_type" }, 415);
  const rawName = request.headers.get("X-File-Name") || "";
  let name = "";
  try { name = decodeURIComponent(rawName).trim(); } catch { name = rawName.trim(); }
  if (!name || name.length > 255) return json({ ok: false, error: "invalid_file_name" }, 400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 20 * 1024 * 1024) return json({ ok: false, error: "file_too_large" }, 413);
  const sha = await sha256Hex(bytes);
  const key = `sop:file:${sha}`;
  const existing = await env.CACHE.getWithMetadata(key, "arrayBuffer");
  if (!existing?.value) {
    await env.CACHE.put(key, bytes, { metadata: { name, type, size: bytes.byteLength } });
  }
  return json({ ok: true, fileId: sha, name, type, size: bytes.byteLength });
}

export async function handleSopFileDownload(request, env, sha) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  if (!/^[a-f0-9]{64}$/i.test(sha)) return json({ ok: false, error: "invalid_file_id" }, 400);
  const result = await env.CACHE.getWithMetadata(`sop:file:${sha}`, "arrayBuffer");
  if (!result?.value) return json({ ok: false, error: "not_found" }, 404);
  const metadata = result.metadata || {};
  return new Response(result.value, {
    status: 200,
    headers: {
      "Content-Type": metadata.type || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-File-Name": encodeURIComponent(metadata.name || sha)
    }
  });
}
