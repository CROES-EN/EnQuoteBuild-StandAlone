import { json } from "./util.js";

// Shared FST roster. Every desktop install pulls the full roster (a few hundred small
// rows at most) and pushes the records it changed; per record, the newest `updated_date`
// wins. Deletes are soft (`is_deleted: true` on the record), so they sync like any edit.
const MAX_BATCH = 500;
const MAX_RECORD_CHARS = 20000;

function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

function isAllowedEmail(email, env) {
  return String(env.ALLOWED_EMAILS_LIST || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

export async function handleFstList(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  const { results } = await env.DB.prepare(
    "SELECT record_json FROM fst_roster ORDER BY updated_at DESC"
  ).all();

  const fsts = [];
  for (const row of results || []) {
    try {
      fsts.push(JSON.parse(row.record_json));
    } catch {
      // A corrupt row must not break the roster for everyone else.
    }
  }
  return json({ ok: true, fsts });
}

export async function handleFstUpsert(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return json({ ok: false, error: "missing_identity" }, 400);
  if (!isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 403);

  const records = Array.isArray(body?.records) ? body.records : null;
  if (!records) return json({ ok: false, error: "records_required" }, 400);
  if (records.length > MAX_BATCH) return json({ ok: false, error: "too_many_records" }, 400);

  const statements = [];
  for (const record of records) {
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const updatedAt = typeof record?.updated_date === "string" ? record.updated_date : "";
    const recordJson = JSON.stringify(record);
    if (!id || id.length > 120 || !updatedAt || Number.isNaN(Date.parse(updatedAt))) {
      return json({ ok: false, error: "invalid_record" }, 400);
    }
    if (recordJson.length > MAX_RECORD_CHARS) return json({ ok: false, error: "record_too_large" }, 400);

    statements.push(env.DB.prepare(`
      INSERT INTO fst_roster (id, record_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        record_json = excluded.record_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      WHERE excluded.updated_at > fst_roster.updated_at
    `).bind(id, recordJson, new Date(updatedAt).toISOString(), email));
  }

  if (statements.length > 0) await env.DB.batch(statements);
  return json({ ok: true, received: statements.length });
}
