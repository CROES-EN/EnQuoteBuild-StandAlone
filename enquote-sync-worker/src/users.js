import { json } from "./util.js";

// Serves the Base44 User list (emails, names, roles) to the desktop apps. Fresh installs have no
// user records of their own, so without this everyone defaulted to "submitter" and tabs like the
// Supervisor Dashboard stayed hidden. The list is fetched from Base44 with the Worker's own API
// key and cached in KV, so a Base44 outage or a burst of app launches doesn't matter.
const CACHE_KEY = "users:v1";
const FRESH_MS = 5 * 60 * 1000;
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;

function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

export function toPublicUser(user) {
  return {
    id: user.id,
    email: String(user.email || "").trim().toLowerCase(),
    full_name: user.full_name ?? null,
    display_name: user.display_name ?? null,
    name: user.name ?? user.full_name ?? null,
    app_role: user.app_role ?? null,
    additional_roles: Array.isArray(user.additional_roles) ? user.additional_roles : [],
    department: user.department ?? null,
    allowed_pages: user.allowed_pages ?? null
  };
}

async function fetchFromBase44(env) {
  const base = String(env.BASE44_API_URL || "").replace(/\/+$/, "");
  const url = `${base}/api/apps/${env.BASE44_APP_ID}/entities/User?limit=500`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-App-Id": String(env.BASE44_APP_ID), api_key: env.BASE44_API_KEY }
  });
  if (!response.ok) throw new Error(`Base44 responded with HTTP ${response.status}`);
  const body = await response.json();
  const list = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null;
  if (!list) throw new Error("Base44 returned an unexpected User list shape");
  return list.filter((user) => user?.email).map(toPublicUser);
}

export async function handleUsers(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);

  const cached = await env.CACHE.get(CACHE_KEY, "json");
  if (cached?.fetchedAt && Date.now() - cached.fetchedAt < FRESH_MS) {
    return json({ ok: true, users: cached.users, fetchedAt: cached.fetchedAt, cached: true });
  }

  try {
    const users = await fetchFromBase44(env);
    if (users.length === 0) throw new Error("Base44 returned no users");
    const payload = { users, fetchedAt: Date.now() };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: KV_TTL_SECONDS });
    return json({ ok: true, users, fetchedAt: payload.fetchedAt, cached: false });
  } catch (error) {
    // Serve the last good list rather than failing everyone's sign-in while Base44 is down.
    if (cached?.users?.length) {
      return json({ ok: true, users: cached.users, fetchedAt: cached.fetchedAt, cached: true, stale: true });
    }
    return json({ ok: false, error: `users_unavailable: ${error.message}` }, 502);
  }
}
