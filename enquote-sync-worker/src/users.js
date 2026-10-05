import { json } from "./util.js";
import { loadEffectiveUsers } from "./access.js";

export { toPublicUser } from "./base44-users.js";

// Serves the user list (emails, names, roles) to the desktop apps: Base44's roles with the Admin
// Menu's overrides applied, so every install agrees on who can see what.
function isAuthorized(request, env) {
  return Boolean(env.OUTBOUND_TOKEN) &&
    request.headers.get("Authorization") === `Bearer ${env.OUTBOUND_TOKEN}`;
}

export async function handleUsers(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const { users, fetchedAt, cached, stale } = await loadEffectiveUsers(env);
    return json({ ok: true, users, fetchedAt, cached, ...(stale ? { stale: true } : {}) });
  } catch (error) {
    return json({ ok: false, error: `users_unavailable: ${error.message}` }, 502);
  }
}
