import { verifyRequestIdentity, checkBrowserOrigin } from "./auth-session.js";
import { effectiveUserFor, isAdminUser, rolesOf } from "./access.js";
import { signUserToken } from "./user-token.js";
import { json } from "./util.js";

const READ_ROUTES = new Set([
  "/api/users", "/api/access/policy", "/api/presence", "/api/fsts",
  "/api/tasks", "/api/preferences", "/api/sops", "/api/sops/versions", "/api/supervisor/index",
  "/api/supervisor/record", "/api/refund-requests", "/api/chat/directory",
  "/api/chat/conversations", "/api/chat/messages", "/api/chat/inbox",
  "/api/chat/reactions", "/api/chat/emojis", "/api/chat/emojis/image", "/api/chat/images",
  "/api/profiles", "/api/gifs/search", "/api/gifs/trending", "/api/quote-backlog",
  "/api/retro-mail", "/api/retro-games", "/api/retro-scores", "/api/Base44_DTO", "/api/tracking-links"
]);
const WRITE_ROUTES = new Set([
  "/api/tasks/upsert", "/api/tasks/delete", "/api/preferences/upsert", "/api/sops/upsert", "/api/sops/delete",
  "/api/sops/files", "/api/supervisor/upsert", "/api/supervisor/delete",
  "/api/chat/conversations", "/api/chat/conversations/update", "/api/chat/messages",
  "/api/chat/read", "/api/chat/reactions", "/api/chat/emojis", "/api/chat/emojis/from-gif",
  "/api/chat/images", "/api/profiles/avatar", "/api/profiles/avatar/remove",
  "/api/profiles/update",
  "/api/refund-requests/submit", "/api/refund-requests/update",
  "/api/refund-requests/import-csv",
  "/api/presence/heartbeat", "/api/presence/remove", "/api/fsts/upsert",
  "/api/errors", "/api/retro-mail/send", "/api/retro-mail/state", "/api/retro-mail/delete",
  "/api/retro-games", "/api/retro-scores", "/api/Base44_DTO",
  "/api/tracking-links/create", "/api/tracking-links/revoke"
]);
const ADMIN_ROUTES = new Set([
  "/api/admin/overview", "/api/admin/user-override", "/api/admin/role-pages",
  "/api/admin/announcement", "/api/admin/sessions", "/api/admin/sessions/clear",
  "/api/admin/chat/remove-message", "/api/admin/sops/purge",
  "/api/admin/profiles/reset-avatar", "/api/admin/audit"
]);

export async function authorizeBrowserRequest(request, env) {
  if (!checkBrowserOrigin(request)) return { error: json({ ok: false, error: "invalid_origin" }, 403) };
  const identity = await verifyRequestIdentity(request, env);
  if (!identity.ok) return { error: json({ ok: false, error: identity.reason }, identity.status) };
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/browser/, "/api");
  const path = url.pathname;
  const isRead = request.method === "GET";
  const fileRead = /^\/api\/(?:sops\/files|profiles\/avatar)\/[a-f0-9]{64}$/.test(path);
  const allowed = ADMIN_ROUTES.has(path) || (isRead
    ? READ_ROUTES.has(path) || fileRead
    : (request.method === "POST" && WRITE_ROUTES.has(path)) || (request.method === "DELETE" && path === "/api/Base44_DTO"));
  if (!allowed) return { error: json({ ok: false, error: "not_found" }, 404) };
  const needsAdmin = ADMIN_ROUTES.has(path) || (!isRead && (
    path === "/api/fsts/upsert"
  ));
  const user = await effectiveUserFor(env, identity.email);
  if (!user || !rolesOf(user).length) return { error: json({ ok: false, error: "role_required" }, 403) };
  if (needsAdmin) {
    if (!isAdminUser(user)) return { error: json({ ok: false, error: "admin_required" }, 403) };
  }
  if (!env.OUTBOUND_TOKEN || !env.USER_TOKEN_SECRET) {
    return { error: json({ ok: false, error: "server_misconfigured" }, 503) };
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${env.OUTBOUND_TOKEN}`);
  headers.set("X-EnQuote-User", await signUserToken(identity.email, env.USER_TOKEN_SECRET));
  let body = isRead ? undefined : await request.arrayBuffer();
  if (!isRead && (headers.get("content-type") || "").includes("application/json") &&
      ["/api/supervisor/upsert", "/api/supervisor/delete", "/api/presence/heartbeat", "/api/presence/remove", "/api/fsts/upsert"].includes(path)) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(body));
      if (path.startsWith("/api/supervisor/") && ["supervisorDailyMetrics", "supervisorReportTables", "pvManufacturers"].includes(payload.collection)) {
        if (!isAdminUser(user)) {
          return { error: json({ ok: false, error: "admin_required" }, 403) };
        }
      }
      body = JSON.stringify({ ...payload, email: identity.email });
    } catch {
      return { error: json({ ok: false, error: "invalid_body" }, 400) };
    }
  }
  headers.delete("content-length");
  return { request: new Request(url, { method: request.method, headers, body }) };
}
