import { authenticateUser } from "./user-token.js";
import { json } from "./util.js";

// Read-only homeowner quote tracking. Coordinators create one link per quote and paste it
// into their email; the homeowner must enter the quote's site ID before anything is shown,
// and only a friendly status, dated timeline, quote number and next step ever leave here.
const encoder = new TextEncoder();
const LINK_ID_BYTES = 16;
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_COOKIE = "__Host-enquote_track";
const QUOTE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

const PREPARING = {
  key: "preparing", label: "Preparing your quote",
  nextStep: "Our team is preparing your quote. No action is needed from you right now."
};
const MATERIALS = {
  key: "materials", label: "Ordering materials",
  nextStep: "We are getting the materials needed for your service. No action is needed from you right now."
};
const STAGES = {
  quote_sent_to_ho: {
    key: "sent", label: "Quote sent to you",
    nextStep: "Please review the quote we emailed you and reply to let us know if you would like to proceed."
  },
  ho_approved_invoice_required: {
    key: "accepted", label: "Quote accepted",
    nextStep: "Thank you! We are preparing your invoice. No action is needed from you right now."
  },
  invoiced: {
    key: "invoiced", label: "Invoice sent",
    nextStep: "Please pay the invoice we emailed you. We will arrange your service once payment is received."
  },
  invoice_paid: {
    key: "paid", label: "Payment received",
    nextStep: "Thank you for your payment. We are arranging the next steps for your service."
  },
  invoice_paid_materials_required: MATERIALS,
  pending_materials: MATERIALS,
  materials_pending_shipment: MATERIALS,
  scheduled: {
    key: "scheduled", label: "Service scheduled",
    nextStep: "Your service visit is being scheduled. Your installer will contact you about the appointment."
  },
  ho_rejected: {
    key: "declined", label: "Quote declined",
    nextStep: "This quote was declined. Reply to our email if you change your mind or have questions."
  },
  on_hold: {
    key: "on_hold", label: "On hold",
    nextStep: "This quote is on hold. Reply to our email if you have any questions."
  }
};

// Internal review steps (drafts, approvals, internal rejections) all read as "preparing".
export function publicStage(status) {
  return STAGES[status] || PREPARING;
}

export function publicQuoteStatus(quote) {
  const stage = publicStage(quote.status);
  const history = (Array.isArray(quote.status_history) ? quote.status_history : [])
    .filter(entry => entry && entry.status && !Number.isNaN(Date.parse(entry.changed_at || "")))
    .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
  const timeline = [];
  const created = Date.parse(quote.created_date || "");
  if (!Number.isNaN(created) && (!history.length || Date.parse(history[0].changed_at) >= created)) {
    timeline.push({ label: PREPARING.label, date: new Date(created).toISOString() });
  }
  for (const entry of history) {
    const label = publicStage(entry.status).label;
    if (timeline.at(-1)?.label !== label) timeline.push({ label, date: new Date(Date.parse(entry.changed_at)).toISOString() });
  }
  if (timeline.at(-1)?.label !== stage.label) {
    const updated = Date.parse(quote.updated_date || "");
    timeline.push({ label: stage.label, date: Number.isNaN(updated) ? null : new Date(updated).toISOString() });
  }
  return {
    quoteNumber: quote.quote_number ? String(quote.quote_number) : null,
    status: stage.label,
    stage: stage.key,
    nextStep: stage.nextStep,
    timeline
  };
}

function b64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function linkSecret(env) {
  return env.TRACKING_LINK_SECRET || env.USER_TOKEN_SECRET || "";
}

async function sign(env, text) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(linkSecret(env)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function linkToken(env, id) {
  return `${id}.${await sign(env, `track-link:${id}`)}`;
}

async function linkIdFromToken(env, token) {
  const match = TOKEN_PATTERN.exec(String(token || ""));
  if (!match) return null;
  return sameText(match[2], await sign(env, `track-link:${match[1]}`)) ? match[1] : null;
}

function publicBaseUrl(request, env) {
  return String(env.PUBLIC_TRACKING_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

const normalizeSiteId = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");

// Same source of truth as the shared snapshot: the newer of the D1 quote row and the Base44
// entity state, and nothing once the quote has been deleted.
export async function loadTrackedQuote(db, quoteId) {
  const state = await db.prepare(
    "SELECT action, record_json, synced_at FROM base44_entity_state WHERE entity_type = 'Quote' AND local_id = ?"
  ).bind(quoteId).first();
  if (state?.action === "delete") return null;
  const row = await db.prepare("SELECT payload, updated_at FROM quotes WHERE id = ?").bind(quoteId).first();
  const parse = (text, stamp) => {
    try {
      const value = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? { ...value, _synced_at: stamp } : null;
    } catch {
      return null;
    }
  };
  const fromState = state ? parse(state.record_json, state.synced_at) : null;
  const fromQuotes = row ? parse(row.payload, row.updated_at) : null;
  const stamp = item => Date.parse(item?.updated_date || item?.updated_at || item?._synced_at || "") || 0;
  if (fromState && fromQuotes) return stamp(fromState) >= stamp(fromQuotes) ? fromState : fromQuotes;
  return fromState || fromQuotes;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function activeLink(db, quoteId) {
  return db.prepare(
    "SELECT id, created_by, created_at FROM tracking_links WHERE quote_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).bind(quoteId).first();
}

async function describeLink(request, env, link) {
  return link ? {
    url: `${publicBaseUrl(request, env)}/track/${await linkToken(env, link.id)}`,
    createdAt: link.created_at,
    createdBy: link.created_by
  } : null;
}

function validQuoteId(value) {
  return typeof value === "string" && QUOTE_ID_PATTERN.test(value) ? value : null;
}

export async function handleTrackingLinkGet(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const quoteId = validQuoteId(new URL(request.url).searchParams.get("quoteId"));
  if (!quoteId) return json({ ok: false, error: "invalid_quote_id" }, 400);
  return json({ ok: true, link: await describeLink(request, env, await activeLink(env.DB, quoteId)) }, 200, { "Cache-Control": "no-store" });
}

export async function handleTrackingLinkCreate(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  if (!linkSecret(env)) return json({ ok: false, error: "tracking_not_configured" }, 503);
  const quoteId = validQuoteId((await readJson(request))?.quoteId);
  if (!quoteId) return json({ ok: false, error: "invalid_quote_id" }, 400);
  const quote = await loadTrackedQuote(env.DB, quoteId);
  if (!quote) return json({ ok: false, error: "quote_not_synced" }, 404);
  if (!normalizeSiteId(quote.site_id)) return json({ ok: false, error: "quote_missing_site_id" }, 409);
  let link = await activeLink(env.DB, quoteId);
  if (!link) {
    link = { id: b64url(crypto.getRandomValues(new Uint8Array(LINK_ID_BYTES))), created_by: user.email, created_at: new Date().toISOString() };
    await env.DB.prepare("INSERT INTO tracking_links (id, quote_id, created_by, created_at) VALUES (?, ?, ?, ?)")
      .bind(link.id, quoteId, link.created_by, link.created_at).run();
  }
  return json({ ok: true, link: await describeLink(request, env, link) });
}

export async function handleTrackingLinkRevoke(request, env) {
  const user = await authenticateUser(request, env);
  if (user.error) return user.error;
  const quoteId = validQuoteId((await readJson(request))?.quoteId);
  if (!quoteId) return json({ ok: false, error: "invalid_quote_id" }, 400);
  const result = await env.DB.prepare(
    "UPDATE tracking_links SET revoked_at = ?, revoked_by = ? WHERE quote_id = ? AND revoked_at IS NULL"
  ).bind(new Date().toISOString(), user.email, quoteId).run();
  return json({ ok: true, revoked: Number(result?.meta?.changes || 0) });
}

// ---------------------------------------------------------------------------
// Public (homeowner) side
// ---------------------------------------------------------------------------
const PUBLIC_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function publicJson(body, status = 200, headers = {}) {
  return json(body, status, { ...PUBLIC_HEADERS, ...headers });
}

async function sessionCookie(env, linkId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const value = `${linkId}.${expires}.${await sign(env, `track-session:${linkId}:${expires}`)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

async function hasSession(request, env, linkId) {
  const cookie = (request.headers.get("Cookie") || "").split(/;\s*/)
    .find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const [id, expires, signature] = String(cookie || "").split(".");
  if (id !== linkId || !signature || !(Number(expires) > Date.now() / 1000)) return false;
  return sameText(signature, await sign(env, `track-session:${linkId}:${expires}`));
}

async function loadLinkAndQuote(env, token) {
  const linkId = linkSecret(env) ? await linkIdFromToken(env, token) : null;
  if (!linkId) return null;
  const link = await env.DB.prepare(
    "SELECT id, quote_id, revoked_at, failed_attempts, failed_window_start FROM tracking_links WHERE id = ?"
  ).bind(linkId).first();
  if (!link || link.revoked_at) return null;
  const quote = await loadTrackedQuote(env.DB, link.quote_id);
  return quote ? { link, quote } : null;
}

const NOT_ACTIVE = { ok: false, error: "link_inactive", message: "This tracking link is no longer active. Please contact us for an updated link." };

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function markViewed(env, linkId) {
  await env.DB.prepare(
    "UPDATE tracking_links SET last_viewed_at = ?, failed_attempts = 0, failed_window_start = NULL WHERE id = ?"
  ).bind(new Date().toISOString(), linkId).run();
}

export async function handleTrackVerify(request, env, token) {
  if (!sameOrigin(request)) return publicJson({ ok: false, error: "forbidden" }, 403);
  const found = await loadLinkAndQuote(env, token);
  if (!found) return publicJson(NOT_ACTIVE, 404);
  const { link, quote } = found;
  const now = Date.now();
  const windowStart = Date.parse(link.failed_window_start || "");
  const windowOpen = !Number.isNaN(windowStart) && now - windowStart < FAILED_WINDOW_MS;
  const failures = windowOpen ? Number(link.failed_attempts || 0) : 0;
  if (failures >= MAX_FAILED_ATTEMPTS) {
    const retryAfter = Math.ceil((windowStart + FAILED_WINDOW_MS - now) / 1000);
    return publicJson({ ok: false, error: "too_many_attempts", message: "Too many attempts. Please wait a few minutes and try again." },
      429, { "Retry-After": String(retryAfter) });
  }
  const body = await readJson(request);
  const siteId = normalizeSiteId(body?.siteId);
  if (!siteId || siteId.length > 64 || siteId !== normalizeSiteId(quote.site_id)) {
    await env.DB.prepare("UPDATE tracking_links SET failed_attempts = ?, failed_window_start = ? WHERE id = ?")
      .bind(failures + 1, windowOpen ? link.failed_window_start : new Date(now).toISOString(), link.id).run();
    return publicJson({ ok: false, error: "site_id_mismatch", message: "That site ID doesn't match this quote. Please check it and try again." }, 401);
  }
  await markViewed(env, link.id);
  return publicJson({ ok: true, quote: publicQuoteStatus(quote) }, 200, { "Set-Cookie": await sessionCookie(env, link.id) });
}

export async function handleTrackStatus(request, env, token) {
  const found = await loadLinkAndQuote(env, token);
  if (!found) return publicJson(NOT_ACTIVE, 404);
  if (!await hasSession(request, env, found.link.id)) return publicJson({ ok: false, error: "verification_required" }, 401);
  await markViewed(env, found.link.id);
  return publicJson({ ok: true, quote: publicQuoteStatus(found.quote) });
}

export function handleTrackPage() {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(trackPageHtml(nonce), {
    headers: {
      ...PUBLIC_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`,
        "connect-src 'self'", "img-src 'self' data:", "form-action 'none'", "base-uri 'none'", "frame-ancestors 'none'"
      ].join("; ")
    }
  });
}

export async function handleTrackRoute(request, env) {
  const match = /^\/track\/([^/]+)(\/verify|\/status)?\/?$/.exec(new URL(request.url).pathname);
  if (!match) return null;
  const [, token, action] = match;
  if (!action && request.method === "GET") return handleTrackPage();
  if (action === "/verify" && request.method === "POST") return handleTrackVerify(request, env, token);
  if (action === "/status" && request.method === "GET") return handleTrackStatus(request, env, token);
  return publicJson({ ok: false, error: "not_found" }, 404);
}

function trackPageHtml(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Quote status</title>
<style nonce="${nonce}">
  :root { color-scheme: light; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#f97316; --ok:#059669; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:#f8fafc; color:var(--ink); }
  main { max-width: 560px; margin: 0 auto; padding: 32px 16px 48px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:24px; box-shadow:0 1px 2px rgba(15,23,42,.05); }
  h1 { font-size:1.35rem; margin:0 0 4px; }
  .muted { color:var(--muted); font-size:.92rem; line-height:1.45; }
  label { display:block; font-weight:600; margin:18px 0 6px; }
  input { width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:1rem; }
  input:focus { outline:2px solid var(--brand); outline-offset:1px; border-color:transparent; }
  button { margin-top:14px; width:100%; padding:11px 12px; border:0; border-radius:10px; background:var(--brand); color:#fff; font-weight:600; font-size:1rem; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .error { color:#b91c1c; margin-top:10px; min-height:1.2em; font-size:.92rem; }
  .pill { display:inline-block; margin-top:12px; padding:6px 12px; border-radius:999px; background:#fff7ed; color:#9a3412; font-weight:600; }
  .next { margin-top:18px; padding:14px; border-radius:10px; background:#f1f5f9; line-height:1.45; }
  ol { list-style:none; padding:0; margin:20px 0 0; }
  li { position:relative; padding:0 0 16px 26px; }
  li::before { content:""; position:absolute; left:6px; top:5px; width:10px; height:10px; border-radius:50%; background:var(--ok); }
  li::after { content:""; position:absolute; left:10px; top:17px; bottom:0; width:2px; background:var(--line); }
  li:last-child::after { display:none; }
  li.current::before { background:#fff; border:2px solid var(--brand); }
  .when { color:var(--muted); font-size:.85rem; }
  [hidden] { display:none !important; }
  footer { margin-top:18px; text-align:center; }
</style>
</head>
<body>
<main>
  <div class="card" id="verify">
    <h1>Check your quote status</h1>
    <p class="muted">For your privacy, enter the site ID for your system to continue. You can find it in the email we sent you or in the Enphase App.</p>
    <form id="form" novalidate>
      <label for="site">Site ID</label>
      <input id="site" name="site" autocomplete="off" inputmode="text" maxlength="64" required>
      <button id="submit" type="submit">View status</button>
      <div class="error" id="error" role="alert"></div>
    </form>
  </div>
  <div class="card" id="result" hidden>
    <p class="muted" id="number"></p>
    <h1>Current status</h1>
    <span class="pill" id="status"></span>
    <div class="next"><strong>Next step</strong><br><span id="next"></span></div>
    <ol id="timeline" aria-label="Quote timeline"></ol>
  </div>
  <footer class="muted">This page is read-only and shows only your quote's progress.</footer>
</main>
<script nonce="${nonce}">
(() => {
  const base = location.pathname.replace(/\\/+$/, "");
  const $ = id => document.getElementById(id);
  const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  function show(quote) {
    $("number").textContent = quote.quoteNumber ? "Quote " + quote.quoteNumber : "";
    $("status").textContent = quote.status;
    $("next").textContent = quote.nextStep;
    const list = $("timeline");
    list.replaceChildren(...quote.timeline.map((step, index) => {
      const item = document.createElement("li");
      if (index === quote.timeline.length - 1) item.className = "current";
      const label = document.createElement("div");
      label.textContent = step.label;
      const when = document.createElement("div");
      when.className = "when";
      when.textContent = formatDate(step.date);
      item.append(label, when);
      return item;
    }));
    $("verify").hidden = true;
    $("result").hidden = false;
  }
  async function call(path, options) {
    const response = await fetch(base + path, { credentials: "same-origin", ...options });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  call("/status").then(({ body }) => { if (body.ok) show(body.quote); else if (body.error === "link_inactive") $("error").textContent = body.message; }).catch(() => {});
  $("form").addEventListener("submit", async event => {
    event.preventDefault();
    const siteId = $("site").value.trim();
    if (!siteId) { $("error").textContent = "Please enter your site ID."; return; }
    $("submit").disabled = true;
    $("error").textContent = "";
    try {
      const { body } = await call("/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId }) });
      if (body.ok) show(body.quote);
      else $("error").textContent = body.message || "Something went wrong. Please try again.";
    } catch {
      $("error").textContent = "We couldn't reach the server. Please check your connection and try again.";
    } finally {
      $("submit").disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}
