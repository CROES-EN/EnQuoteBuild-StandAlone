// Base44's User list (emails, names, roles), fetched with the Worker's own API key and cached in
// KV so a Base44 outage or a burst of app launches doesn't matter.
export const USERS_CACHE_KEY = "users:v1";
const FRESH_MS = 5 * 60 * 1000;
const KV_TTL_SECONDS = 7 * 24 * 60 * 60;

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

async function readCache(env) {
  let cached = await env.CACHE?.get?.(USERS_CACHE_KEY, "json");
  if (typeof cached === "string") {
    try { cached = JSON.parse(cached); } catch { cached = null; }
  }
  return cached && Array.isArray(cached.users) ? cached : null;
}

// Returns { users, fetchedAt, cached, stale }. Serves the last good list rather than failing
// while Base44 is down; throws only when there has never been a good list.
export async function loadBase44Users(env, { fetchImpl = fetchFromBase44 } = {}) {
  const cached = await readCache(env);
  if (cached?.fetchedAt && Date.now() - cached.fetchedAt < FRESH_MS) {
    return { users: cached.users, fetchedAt: cached.fetchedAt, cached: true };
  }
  try {
    const users = await fetchImpl(env);
    if (users.length === 0) throw new Error("Base44 returned no users");
    const payload = { users, fetchedAt: Date.now() };
    await env.CACHE.put(USERS_CACHE_KEY, JSON.stringify(payload), { expirationTtl: KV_TTL_SECONDS });
    return { users, fetchedAt: payload.fetchedAt, cached: false };
  } catch (error) {
    if (cached?.users?.length) return { users: cached.users, fetchedAt: cached.fetchedAt, cached: true, stale: true };
    throw error;
  }
}
