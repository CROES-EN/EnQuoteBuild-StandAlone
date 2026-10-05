import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleAccessPolicy,
  handleAdminAnnouncement,
  handleAdminAudit,
  handleAdminOverview,
  handleAdminRolePages,
  handleAdminSessions,
  handleAdminUserOverride
} from "../src/admin.js";
import { signUserToken } from "../src/user-token.js";
import { createAdminD1 } from "../test-helpers/d1Shim.js";

const secret = "0123456789abcdef0123456789abcdef";
const adminEmail = "admin@example.com";
const heatherEmail = "heather@example.com";

function makeCache(users) {
  const store = new Map([["users:v1", JSON.stringify({ fetchedAt: Date.now(), users })]]);
  return {
    async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
    async put(key, value) { store.set(key, value); }
  };
}

function makeEnv() {
  return {
    OUTBOUND_TOKEN: "outbound",
    USER_TOKEN_SECRET: secret,
    ALLOWED_EMAILS_LIST: `${adminEmail},${heatherEmail}`,
    CACHE: makeCache([
      { id: "u-admin", email: adminEmail, full_name: "Admin", app_role: "admin", additional_roles: [] },
      { id: "u-heather", email: heatherEmail, full_name: "Heather", app_role: "submitter", additional_roles: [] }
    ]),
    DB: createAdminD1()
  };
}

async function request(path, email, method = "GET", body) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Authorization: "Bearer outbound",
      "X-EnQuote-User": await signUserToken(email, secret),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function jsonOf(response) {
  return response.json();
}

test("admin endpoints enforce admin role and expose effective overview", async () => {
  const env = makeEnv();
  const denied = await handleAdminOverview(await request("/api/admin/overview", heatherEmail), env);
  assert.equal(denied.status, 403);

  const overview = await jsonOf(await handleAdminOverview(await request("/api/admin/overview", adminEmail), env));
  assert.equal(overview.ok, true);
  assert.deepEqual(overview.roles, ["submitter", "approver", "invoicer", "admin", "super_admin"]);
  assert.equal(overview.users.find((user) => user.email === heatherEmail).app_role, "submitter");
});

test("user overrides change effective roles, audit, and protect the last admin", async () => {
  const env = makeEnv();
  const override = await handleAdminUserOverride(
    await request("/api/admin/user-override", adminEmail, "POST", {
      email: heatherEmail,
      app_role: "approver",
      additional_roles: ["invoicer"],
      allow_pages: ["SupervisorDashboard"],
      deny_pages: ["Users"]
    }),
    env
  );
  assert.equal(override.status, 200);

  const overview = await jsonOf(await handleAdminOverview(await request("/api/admin/overview", adminEmail), env));
  const heather = overview.users.find((user) => user.email === heatherEmail);
  assert.equal(heather.app_role, "approver");
  assert.deepEqual(heather.additional_roles, ["invoicer"]);
  assert.deepEqual(heather.allow_pages, ["SupervisorDashboard"]);
  assert.equal(heather.role_source, "override");

  const lastAdmin = await handleAdminUserOverride(
    await request("/api/admin/user-override", adminEmail, "POST", { email: adminEmail, app_role: "submitter", additional_roles: [] }),
    env
  );
  assert.equal(lastAdmin.status, 409);
  assert.equal((await lastAdmin.json()).error, "last_admin");

  const audit = await jsonOf(await handleAdminAudit(await request("/api/admin/audit", adminEmail), env));
  assert.equal(audit.entries[0].action, "user_override_set");
  assert.equal(audit.entries[0].target, heatherEmail);
});

test("access policy returns role pages and announcement", async () => {
  const env = makeEnv();
  await handleAdminRolePages(
    await request("/api/admin/role-pages", adminEmail, "POST", { rolePages: { submitter: ["Dashboard"], approver: ["SupervisorDashboard"], invoicer: [], admin: [], super_admin: [] } }),
    env
  );
  await handleAdminAnnouncement(
    await request("/api/admin/announcement", adminEmail, "POST", { level: "urgent", text: "Update now" }),
    env
  );

  const policy = await jsonOf(await handleAccessPolicy(await request("/api/access/policy", heatherEmail), env));
  assert.equal(policy.ok, true);
  assert.equal(policy.me.email, heatherEmail);
  assert.deepEqual(policy.rolePages.approver, ["SupervisorDashboard"]);
  assert.equal(policy.announcement.level, "urgent");
  assert.equal(policy.announcement.text, "Update now");
});

test("admin sessions include version and role details", async () => {
  const env = makeEnv();
  await env.DB.prepare(`INSERT INTO presence_sessions (session_id, email, name, signed_in_at, last_seen_at, app_version, ui_version, resolved_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind("s1", heatherEmail, "Heather", "2026-10-05T19:00:00.000Z", new Date().toISOString(), "1.4.0", "ui-1", "submitter")
    .run();
  const sessions = await jsonOf(await handleAdminSessions(await request("/api/admin/sessions", adminEmail), env));
  assert.equal(sessions.sessions[0].sessionId, "s1");
  assert.equal(sessions.sessions[0].appVersion, "1.4.0");
  assert.equal(sessions.sessions[0].uiVersion, "ui-1");
  assert.equal(sessions.sessions[0].resolvedRole, "submitter");
  assert.equal(sessions.sessions[0].effectiveRole, "submitter");
});
