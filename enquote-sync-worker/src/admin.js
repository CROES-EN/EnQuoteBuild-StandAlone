import { auditLog, effectiveUserFor, isAdminUser, loadEffectiveUsers, normalizeEmail, requireAdmin, ROLES } from "./access.js";
import { authenticateUser, inboxKeyForEmail, isAllowedEmail } from "./user-token.js";
import { loadBase44Users } from "./base44-users.js";
import { broadcastMessage } from "./realtime.js";
import { json } from "./util.js";
import { parseRecord } from "./tasks.js";

const SETTING_ROLE_PAGES = "role_pages";
const SETTING_ANNOUNCEMENT = "announcement";
const PRESENCE_TTL_MS = 2 * 60 * 1000;
const VALID_ANNOUNCEMENT_LEVELS = new Set(["info", "warning", "urgent"]);

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function adminAuth(request, env) {
  return requireAdmin(request, env);
}

async function getSetting(env, key) {
  const row = (await env.DB.prepare("SELECT value FROM admin_settings WHERE key = ?").bind(key).all()).results?.[0];
  return parseRecord(row?.value);
}

async function putSetting(env, key, value, actor) {
  await env.DB.prepare(`
    INSERT INTO admin_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).bind(key, JSON.stringify(value), actor, new Date().toISOString()).run();
}

async function deleteSetting(env, key) {
  await env.DB.prepare("DELETE FROM admin_settings WHERE key = ?").bind(key).run();
}

function publicSettingAnnouncement(value) {
  if (!value || typeof value !== "object" || !value.text) return null;
  return {
    id: String(value.id || ""),
    level: VALID_ANNOUNCEMENT_LEVELS.has(value.level) ? value.level : "info",
    text: String(value.text || ""),
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null
  };
}

function normalizePages(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((page) => String(page || "").trim()).filter(Boolean))].sort();
}

function validateRolePages(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out = {};
  for (const [role, pages] of Object.entries(input)) {
    if (!ROLES.includes(role) || !Array.isArray(pages)) return null;
    out[role] = normalizePages(pages);
  }
  return out;
}

function validateRoles(appRole, additionalRoles) {
  if (appRole != null && appRole !== "" && !ROLES.includes(appRole)) return false;
  if (additionalRoles != null && (!Array.isArray(additionalRoles) || additionalRoles.some((role) => !ROLES.includes(role)))) return false;
  return true;
}

async function assertAdminsRemain(env, actorEmail, targetEmail, nextOverride, clear) {
  const { users } = await loadEffectiveUsers(env);
  const base = await loadBase44Users(env).catch(() => ({ users: [] }));
  const before = users.find((user) => normalizeEmail(user.email) === targetEmail);
  const baseTarget = base.users.find((user) => normalizeEmail(user.email) === targetEmail) || {
    email: targetEmail,
    app_role: null,
    additional_roles: []
  };
  const nextUsers = users.map((user) => {
    if (normalizeEmail(user.email) !== targetEmail) return user;
    if (clear) {
      return { ...baseTarget, allow_pages: [], deny_pages: [], role_source: "base44" };
    }
    return {
      ...user,
      app_role: nextOverride.app_role || baseTarget.app_role || null,
      additional_roles: nextOverride.additional_roles ?? baseTarget.additional_roles ?? [],
      allow_pages: nextOverride.allow_pages,
      deny_pages: nextOverride.deny_pages
    };
  });
  if (!nextUsers.some(isAdminUser)) return "last_admin";
  if (targetEmail === actorEmail && isAdminUser(before) && !isAdminUser(nextUsers.find((user) => normalizeEmail(user.email) === targetEmail))) {
    return "self_demotion";
  }
  return null;
}

export async function handleAccessPolicy(request, env) {
  const auth = await authenticateUser(request, env);
  if (auth.error) return auth.error;
  const rolePages = await getSetting(env, SETTING_ROLE_PAGES);
  const announcement = publicSettingAnnouncement(await getSetting(env, SETTING_ANNOUNCEMENT));
  let me = null;
  try { me = await effectiveUserFor(env, auth.email); } catch { /* users may be temporarily unavailable */ }
  return json({ ok: true, rolePages: rolePages || null, me, announcement });
}

export async function handleAdminOverview(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const { users } = await loadEffectiveUsers(env, { strict: true });
  return json({
    ok: true,
    users,
    rolePages: (await getSetting(env, SETTING_ROLE_PAGES)) || null,
    announcement: publicSettingAnnouncement(await getSetting(env, SETTING_ANNOUNCEMENT)),
    roles: ROLES
  });
}

export async function handleAdminUserOverride(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  if (!email || !isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 400);
  if (body?.clear) {
    const guard = await assertAdminsRemain(env, auth.email, email, null, true);
    if (guard) return json({ ok: false, error: guard }, 409);
    await env.DB.prepare("DELETE FROM admin_user_overrides WHERE email = ?").bind(email).run();
    await auditLog(env, auth.email, "user_override_clear", email, {});
  } else {
    const appRole = body?.app_role == null || body.app_role === "" ? null : String(body.app_role);
    if (body?.additional_roles != null && !Array.isArray(body.additional_roles)) return json({ ok: false, error: "invalid_role" }, 400);
    const additionalRoles = body?.additional_roles == null ? null : [...new Set(body.additional_roles.map(String))];
    if (!validateRoles(appRole, additionalRoles)) return json({ ok: false, error: "invalid_role" }, 400);
    const override = {
      app_role: appRole,
      additional_roles: additionalRoles,
      allow_pages: normalizePages(body?.allow_pages),
      deny_pages: normalizePages(body?.deny_pages)
    };
    const guard = await assertAdminsRemain(env, auth.email, email, override, false);
    if (guard) return json({ ok: false, error: guard }, 409);
    await env.DB.prepare(`
      INSERT INTO admin_user_overrides (email, app_role, additional_roles, allow_pages, deny_pages, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        app_role = excluded.app_role, additional_roles = excluded.additional_roles,
        allow_pages = excluded.allow_pages, deny_pages = excluded.deny_pages,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).bind(email, override.app_role, override.additional_roles == null ? null : JSON.stringify(override.additional_roles),
      JSON.stringify(override.allow_pages), JSON.stringify(override.deny_pages), auth.email, new Date().toISOString()).run();
    await auditLog(env, auth.email, "user_override_set", email, override);
  }
  await broadcastMessage(env, { type: "users_updated" });
  return json({ ok: true });
}

export async function handleAdminRolePages(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  if (body?.reset) {
    await deleteSetting(env, SETTING_ROLE_PAGES);
    await auditLog(env, auth.email, "role_pages_reset", null, {});
  } else {
    const rolePages = validateRolePages(body?.rolePages);
    if (!rolePages) return json({ ok: false, error: "invalid_role_pages" }, 400);
    await putSetting(env, SETTING_ROLE_PAGES, rolePages, auth.email);
    await auditLog(env, auth.email, "role_pages_set", null, rolePages);
  }
  await broadcastMessage(env, { type: "policy_updated" });
  return json({ ok: true });
}

export async function handleAdminAnnouncement(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  if (body?.clear) {
    await deleteSetting(env, SETTING_ANNOUNCEMENT);
    await auditLog(env, auth.email, "announcement_clear", null, {});
  } else {
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const level = String(body?.level || "info");
    if (!text || text.length > 500 || !VALID_ANNOUNCEMENT_LEVELS.has(level)) return json({ ok: false, error: "invalid_announcement" }, 400);
    const announcement = { id: crypto.randomUUID(), level, text, updatedAt: new Date().toISOString(), updatedBy: auth.email };
    await putSetting(env, SETTING_ANNOUNCEMENT, announcement, auth.email);
    await auditLog(env, auth.email, "announcement_set", null, { level });
  }
  await broadcastMessage(env, { type: "policy_updated" });
  return json({ ok: true });
}

export async function handleAdminSessions(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  const { users } = await loadEffectiveUsers(env);
  const byEmail = new Map(users.map((user) => [normalizeEmail(user.email), user]));
  const { results } = await env.DB.prepare(`
    SELECT session_id AS sessionId, email, name, last_seen_at AS lastSeen,
      app_version AS appVersion, ui_version AS uiVersion, resolved_role AS resolvedRole
    FROM presence_sessions ORDER BY last_seen_at DESC
  `).all();
  return json({ ok: true, sessions: (results || []).map((row) => {
    const user = byEmail.get(normalizeEmail(row.email));
    return {
      ...row,
      effectiveRole: user?.app_role || null,
      stale: !row.lastSeen || row.lastSeen < cutoff
    };
  }) });
}

export async function handleAdminSessionsClear(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  if (body?.sessionId) {
    await env.DB.prepare("DELETE FROM presence_sessions WHERE session_id = ?").bind(String(body.sessionId)).run();
  } else if (body?.email) {
    await env.DB.prepare("DELETE FROM presence_sessions WHERE email = ?").bind(normalizeEmail(body.email)).run();
  } else {
    await env.DB.prepare("DELETE FROM presence_sessions WHERE last_seen_at < ?").bind(new Date(Date.now() - PRESENCE_TTL_MS).toISOString()).run();
  }
  await auditLog(env, auth.email, "sessions_clear", body?.email || body?.sessionId || null, {});
  return json({ ok: true });
}

export async function handleAdminCommand(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  const command = String(body?.command || "");
  if (!email || !["reload", "sign_out"].includes(command)) return json({ ok: false, error: "invalid_command" }, 400);
  await broadcastMessage(env, { type: "admin_command", key: await inboxKeyForEmail(email, env.USER_TOKEN_SECRET), command, id: crypto.randomUUID() });
  await auditLog(env, auth.email, `command_${command}`, email, {});
  return json({ ok: true });
}

export async function handleAdminChatRemoveMessage(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const messageId = String(body?.messageId || "").trim();
  if (!messageId) return json({ ok: false, error: "invalid_message_id" }, 400);
  const row = (await env.DB.prepare("SELECT conversation_id AS conversationId FROM chat_messages WHERE id = ?").bind(messageId).all()).results?.[0];
  if (!row) return json({ ok: false, error: "not_found" }, 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE chat_messages SET body = ?, attachments = ? WHERE id = ?").bind("[removed by admin]", "[]", messageId),
    env.DB.prepare("DELETE FROM chat_reactions WHERE message_id = ?").bind(messageId)
  ]);
  const members = (await env.DB.prepare("SELECT email FROM chat_members WHERE conversation_id = ? AND left_at IS NULL").bind(row.conversationId).all()).results || [];
  const keys = [];
  for (const member of members) keys.push(await inboxKeyForEmail(member.email, env.USER_TOKEN_SECRET));
  await broadcastMessage(env, { type: "inbox_updated", keys });
  await auditLog(env, auth.email, "chat_remove_message", messageId, { conversationId: row.conversationId });
  return json({ ok: true });
}

export async function handleAdminSopPurge(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const id = String(body?.id || "").trim();
  if (!id) return json({ ok: false, error: "invalid_id" }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE sop_docs SET deleted = 1, data = NULL, synced_at = ? WHERE id = ?").bind(new Date().toISOString(), id),
    env.DB.prepare("DELETE FROM sop_versions WHERE doc_id = ?").bind(id)
  ]);
  await broadcastMessage(env, { type: "sops_updated", id });
  await auditLog(env, auth.email, "sop_purge", id, {});
  return json({ ok: true });
}

export async function handleAdminProfileResetAvatar(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const email = normalizeEmail(body?.email);
  if (!email || !isAllowedEmail(email, env)) return json({ ok: false, error: "email_not_allowed" }, 400);
  await env.DB.prepare("DELETE FROM user_profiles WHERE email = ?").bind(email).run();
  await broadcastMessage(env, { type: "profiles_updated" });
  await auditLog(env, auth.email, "profile_reset_avatar", email, {});
  return json({ ok: true });
}

export async function handleAdminAudit(request, env) {
  const auth = await adminAuth(request, env);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 100)));
  const before = Number(url.searchParams.get("before") || 0);
  const { results } = before > 0
    ? await env.DB.prepare("SELECT id, at, actor, action, target, details FROM admin_audit WHERE id < ? ORDER BY id DESC LIMIT ?").bind(before, limit).all()
    : await env.DB.prepare("SELECT id, at, actor, action, target, details FROM admin_audit ORDER BY id DESC LIMIT ?").bind(limit).all();
  return json({ ok: true, entries: (results || []).map((row) => ({ ...row, details: parseRecord(row.details) })) });
}
