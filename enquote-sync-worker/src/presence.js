import { json } from "./util.js";

const PRESENCE_TTL_MS = 3 * 60 * 1000;
// A heartbeat only rewrites its row once it is this old (or details changed); comfortably inside the TTL.
const PRESENCE_REFRESH_MS = 90 * 1000;

function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

function isAllowedEmail(email, env) {
  const allowedEmails = new Set(
    String(env.ALLOWED_EMAILS_LIST || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  return allowedEmails.has(email);
}

async function readPayload(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handlePresenceHeartbeat(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await readPayload(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim().slice(0, 40) : "";
  const uiVersion = typeof body?.uiVersion === "string" ? body.uiVersion.trim().slice(0, 40) : "";
  const resolvedRole = typeof body?.resolvedRole === "string" ? body.resolvedRole.trim().slice(0, 40) : "";
  if (!email || !sessionId) return json({ ok: false, error: "missing_presence_identity" }, 400);
  if (!isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 403);

  const now = new Date().toISOString();
  const refreshBefore = new Date(Date.now() - PRESENCE_REFRESH_MS).toISOString();
  await env.DB.prepare(`
    INSERT INTO presence_sessions (session_id, email, name, signed_in_at, last_seen_at, app_version, ui_version, resolved_role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      last_seen_at = excluded.last_seen_at,
      app_version = excluded.app_version,
      ui_version = excluded.ui_version,
      resolved_role = excluded.resolved_role
    WHERE presence_sessions.last_seen_at < ?
      OR presence_sessions.email IS NOT excluded.email
      OR presence_sessions.name IS NOT excluded.name
      OR presence_sessions.app_version IS NOT excluded.app_version
      OR presence_sessions.ui_version IS NOT excluded.ui_version
      OR presence_sessions.resolved_role IS NOT excluded.resolved_role
  `).bind(sessionId, email, name || email, now, now, appVersion, uiVersion, resolvedRole, refreshBefore).run();

  return json({ ok: true, lastSeenAt: now });
}

export async function handlePresenceRemove(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await readPayload(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!email || !sessionId) return json({ ok: false, error: "missing_presence_identity" }, 400);
  if (!isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 403);

  await env.DB.prepare("DELETE FROM presence_sessions WHERE session_id = ? AND email = ?")
    .bind(sessionId, email)
    .run();
  return json({ ok: true });
}

export async function handlePresenceList(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  await env.DB.prepare("DELETE FROM presence_sessions WHERE last_seen_at < ?").bind(cutoff).run();
  const { results } = await env.DB.prepare(`
    SELECT email, name, MIN(signed_in_at) AS signedInAt, MAX(last_seen_at) AS lastSeenAt
    FROM presence_sessions
    WHERE last_seen_at >= ?
    GROUP BY email
    ORDER BY MAX(last_seen_at) DESC
  `).bind(cutoff).all();

  return json({ ok: true, sessions: results || [] });
}
