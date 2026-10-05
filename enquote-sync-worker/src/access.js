// Effective roles and page access: Base44's roles with the Admin Menu's overrides on top, plus
// the helpers every admin-only endpoint uses (requireAdmin, auditLog).
import { authenticateUser, isAllowedEmail } from "./user-token.js";
import { loadBase44Users } from "./base44-users.js";
import { json } from "./util.js";

export const ROLES = Object.freeze(["submitter", "approver", "invoicer", "admin", "super_admin"]);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

export const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

export function parseJsonList(text) {
  if (Array.isArray(text)) return text;
  if (typeof text !== "string" || !text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// Overrides are optional: with no database (or before migration 0006) everyone keeps their Base44 roles.
export async function loadOverrides(env, { strict = false } = {}) {
  const map = new Map();
  if (!env.DB) return map;
  let results;
  try {
    ({ results } = await env.DB.prepare(`
      SELECT email, app_role, additional_roles, allow_pages, deny_pages, updated_by, updated_at
      FROM admin_user_overrides
    `).all());
  } catch (error) {
    if (strict) throw error;
    console.warn("admin_user_overrides unavailable:", error.message);
    return map;
  }
  for (const row of results || []) {
    map.set(normalizeEmail(row.email), {
      email: normalizeEmail(row.email),
      app_role: row.app_role || null,
      additional_roles: row.additional_roles == null ? null : parseJsonList(row.additional_roles),
      allow_pages: parseJsonList(row.allow_pages),
      deny_pages: parseJsonList(row.deny_pages),
      updated_by: row.updated_by,
      updated_at: row.updated_at
    });
  }
  return map;
}

// Applies one override to a public user record. Roles in the override replace Base44's; page
// lists are added as allow_pages/deny_pages, which the app applies on top of the role matrix.
export function applyOverride(user, override) {
  const base = { ...user, allow_pages: [], deny_pages: [], role_source: "base44" };
  if (!override) return base;
  return {
    ...base,
    app_role: override.app_role || base.app_role || null,
    additional_roles: override.additional_roles ?? base.additional_roles ?? [],
    allow_pages: override.allow_pages,
    deny_pages: override.deny_pages,
    role_source: override.app_role || override.additional_roles ? "override" : "base44"
  };
}

// Every person the app should know about: Base44 users (with overrides applied) plus anyone on
// the access list who only has an override (not yet in Base44).
export async function loadEffectiveUsers(env, options) {
  const loaded = await loadBase44Users(env, options);
  const overrides = await loadOverrides(env);
  const users = loaded.users.map((user) => applyOverride(user, overrides.get(normalizeEmail(user.email))));
  const known = new Set(users.map((user) => normalizeEmail(user.email)));
  for (const [email, override] of overrides) {
    if (known.has(email) || !isAllowedEmail(email, env)) continue;
    users.push(applyOverride({
      id: `override-${email}`, email, full_name: null, display_name: null, name: null,
      app_role: null, additional_roles: [], department: null, allowed_pages: null
    }, override));
  }
  return { ...loaded, users };
}

export function rolesOf(user) {
  return [user?.app_role, ...(Array.isArray(user?.additional_roles) ? user.additional_roles : [])].filter(Boolean);
}

export function isAdminUser(user) {
  return rolesOf(user).some((role) => ADMIN_ROLES.has(role));
}

export async function effectiveUserFor(env, email) {
  const { users } = await loadEffectiveUsers(env);
  return users.find((user) => normalizeEmail(user.email) === normalizeEmail(email)) || null;
}

// Authenticates the caller with their signed user token, then checks their effective role.
// Returns { email, inboxKey, user } or { error: Response }.
export async function requireAdmin(request, env) {
  const auth = await authenticateUser(request, env);
  if (auth.error) return auth;
  let user;
  try {
    user = await effectiveUserFor(env, auth.email);
  } catch (error) {
    return { error: json({ ok: false, error: "roles_unavailable", detail: error.message }, 503) };
  }
  if (!isAdminUser(user)) return { error: json({ ok: false, error: "admin_required" }, 403) };
  return { ...auth, user };
}

export async function auditLog(env, actor, action, target = null, details = null) {
  await env.DB.prepare("INSERT INTO admin_audit (at, actor, action, target, details) VALUES (?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), actor, action, target, details == null ? null : JSON.stringify(details))
    .run();
}
