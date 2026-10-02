import { json } from "./util.js";

// Collects error reports from the desktop apps so problems are seen before users complain.
// Identical errors from the same person are folded into one row with a counter.
const MAX_ERRORS_PER_REQUEST = 20;

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

const clip = (value, max) => String(value ?? "").slice(0, max);

export async function handleErrorReport(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 403);
  const errors = Array.isArray(body?.errors) ? body.errors.slice(0, MAX_ERRORS_PER_REQUEST) : [];
  if (errors.length === 0) return json({ ok: true, stored: 0 });

  const now = new Date().toISOString();
  const statements = [];
  for (const item of errors) {
    const fingerprint = clip(item?.fingerprint, 100);
    if (!fingerprint) continue;
    statements.push(env.DB.prepare(`
      INSERT INTO error_reports
        (fingerprint, email, app_version, ui_version, source, message, stack, page, first_seen, last_seen, occurrences)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint, email) DO UPDATE SET
        last_seen = excluded.last_seen,
        app_version = excluded.app_version,
        ui_version = excluded.ui_version,
        occurrences = error_reports.occurrences + excluded.occurrences
    `).bind(
      fingerprint, email, clip(body.appVersion, 40), clip(body.uiVersion, 60), clip(item.source, 80),
      clip(item.message, 1000), clip(item.stack, 4000), clip(item.page, 200), now, now,
      Math.max(1, Math.min(Number(item.count) || 1, 1000))
    ));
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return json({ ok: true, stored: statements.length });
}

// Most recent first. Optional ?since=<ISO> and ?limit=<n>.
export async function handleErrorList(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const since = url.searchParams.get("since") || "1970-01-01T00:00:00.000Z";
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 100, 500));
  const { results } = await env.DB.prepare(`
    SELECT fingerprint, email, app_version AS appVersion, ui_version AS uiVersion, source, message, stack, page,
           first_seen AS firstSeen, last_seen AS lastSeen, occurrences
    FROM error_reports
    WHERE last_seen >= ?
    ORDER BY last_seen DESC
    LIMIT ?
  `).bind(since, limit).all();
  return json({ ok: true, errors: results || [] });
}
