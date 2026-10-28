import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSupervisorD1 } from "../test-helpers/d1Shim.js";
import { handleLogin, handleRegister, handleAuthSession, handleSyncCredentials, handleLogout } from "../src/auth-session.js";
import { signUserToken, verifyUserToken } from "../src/user-token.js";
import { authorizeBrowserRequest } from "../src/browser-api.js";
import { buildSnapshotAllEntities } from "../src/snapshot-all-entities.js";
import { handleWebSnapshot } from "../src/web-snapshot.js";
import { handleSopsUpsert, handleSopsVersions } from "../src/sops.js";
import { handleProfileUpdate } from "../src/profiles.js";
import { handleEntityWrite } from "../src/entity-write.js";
import { handleInboundBase44 } from "../src/inbound.js";

const email = "alice@example.com";
const secret = "browser-session-test-secret-0123456789";
const stamp = "2026-01-01T00:00:00.000Z";

function environment(role = "submitter") {
  const DB = createSupervisorD1([
    { sql: readFileSync(new URL("../schema.sql", import.meta.url), "utf8") },
    "0005_collab.sql", "0016_browser_sessions.sql",
    { sql: `CREATE TABLE admin_user_overrides (
      email TEXT PRIMARY KEY, app_role TEXT, additional_roles TEXT, allow_pages TEXT,
      deny_pages TEXT, updated_by TEXT, updated_at TEXT);` }
  ]);
  const cache = new Map([["users:v1", {
    users: [{ id: "alice", email, app_role: role }], fetchedAt: Date.now()
  }]]);
  return {
    DB, USER_TOKEN_SECRET: secret, ALLOWED_EMAILS_LIST: email,
    OUTBOUND_TOKEN: "internal-only", SNAPSHOT_TOKEN: "desktop-only",
    CACHE: {
      get: async key => cache.get(key) || null,
      delete: async key => cache.delete(key),
      put: async (key, value) => cache.set(key, JSON.parse(value))
    }
  };
}
async function request(path, body, extraHeaders = {}) {
  return new Request(`https://enquote.example${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: `__Host-enquote_session=${await signUserToken(email, secret)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("browser sessions use secure cookies, reject forged identity, and cannot obtain desktop secrets", async () => {
  const env = environment();
  const response = await handleAuthSession(await request("/auth/session"), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).email, email);
  assert.equal((await handleAuthSession(await request("/auth/session", undefined, {
    "X-EnQuote-User": "stale-token"
  }), env)).status, 200);
  const credentials = await handleSyncCredentials(await request("/auth/sync-credentials"), env);
  assert.equal(credentials.status, 403);
  assert.equal(JSON.stringify(await credentials.json()).includes("internal-only"), false);
  const forged = await handleAuthSession(new Request("https://enquote.example/auth/session", {
    headers: { Cookie: "CF_Authorization=forged" }
  }), env, async () => { throw new Error("invalid signature"); });
  assert.equal(forged.status, 401);
  const logout = handleLogout(await request("/auth/logout", {}));
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(handleLogout(await request("/auth/logout", {}, { Origin: "https://evil.example" })).status, 403);
});

test("registration needs verified company identity; login returns no tokens or service keys and rate limits", async () => {
  const env = environment();
  const body = { email, password: "a-strong-test-password" };
  assert.equal((await handleLogin(await request("/auth/login", null), env)).status, 400);
  const rejected = await handleRegister(await request("/auth/register", body), env, async () => null);
  assert.equal(rejected.status, 401);
  const registered = await handleRegister(await request("/auth/register", body, {
    "cf-access-jwt-assertion": "verified-test-identity"
  }), env, async () => ({ email }));
  assert.equal(registered.status, 200);
  for (let attempt = 1; attempt <= 11; attempt++) {
    const response = await handleLogin(await request("/auth/login", body), env);
    assert.equal(response.status, attempt <= 10 ? 200 : 429);
    if (attempt <= 10) {
      assert.match(response.headers.get("set-cookie"), /__Host-enquote_session=/);
      const result = await response.json();
      assert.equal(result.email, email);
      for (const key of ["userToken", "apiKey", "outboundToken", "snapshotToken"]) assert.equal(result[key], undefined);
    }
  }
});

test("browser gateway rejects unknown routes and cross-origin writes, enforces roles, and binds actor identity", async () => {
  const env = environment();
  assert.equal((await authorizeBrowserRequest(await request("/api/browser/auth/sync-credentials"), env)).error.status, 404);
  assert.equal((await authorizeBrowserRequest(await request("/api/browser/admin/overview"), env)).error.status, 403);
  assert.equal((await authorizeBrowserRequest(await request("/api/browser/tasks/upsert", {}, {
    Origin: "https://evil.example"
  }), env)).error.status, 403);
  const denied = await authorizeBrowserRequest(await request("/api/browser/supervisor/upsert", {
    collection: "supervisorReportTables", id: "reports"
  }), env);
  assert.equal(denied.error.status, 403);
  const forwarded = await authorizeBrowserRequest(await request("/api/browser/presence/heartbeat", {
    email: "someone-else@example.com", sessionId: "test"
  }), env);
  assert.equal(new URL(forwarded.request.url).pathname, "/api/presence/heartbeat");
  assert.equal((await forwarded.request.json()).email, email);
  assert.equal(forwarded.request.headers.get("authorization"), "Bearer internal-only");
  assert.equal((await authorizeBrowserRequest(await request("/api/browser/tasks"), environment(null))).error.status, 403);
  for (const [path, body] of [["/api/browser/preferences", undefined], ["/api/browser/preferences/upsert", { entries: [] }]]) {
    const preferences = await authorizeBrowserRequest(await request(path, body), env);
    assert.equal(new URL(preferences.request.url).pathname, path.replace("/api/browser", "/api"));
    assert.equal((await verifyUserToken(preferences.request.headers.get("x-enquote-user"), secret)).email, email);
  }
});

test("shared snapshots page entities, preserve tombstones and keep browser revisions out of desktop records", async () => {
  const env = environment();
  const insert = (type, id, action, record, time = stamp) => env.DB.prepare(
    "INSERT INTO base44_entity_state VALUES (?, ?, ?, ?, 'test', ?)"
  ).bind(type, id, action, JSON.stringify(record), time).run();
  await env.DB.prepare("INSERT INTO quotes VALUES (?, ?, ?, ?, ?, ?)").bind(
    "deleted", "Q-1", null, JSON.stringify({ id: "deleted" }), stamp, stamp
  ).run();
  await insert("Quote", "deleted", "delete", {});
  await insert("Quote", "live", "update", { id: "live", _rev: 7 });
  for (let i = 0; i < 105; i++) await insert("Product", `product-${i}`, "create", { id: `product-${i}` });
  const desktop = await buildSnapshotAllEntities(env);
  assert.equal(desktop.products.length, 105);
  assert.deepEqual(desktop.quotes.map(item => item.id), ["live"]);
  assert.equal(desktop.quotes[0]._rev, undefined);
  const browser = await (await handleWebSnapshot(await request("/api/web-snapshot"), env)).json();
  assert.equal(browser.quotes[0]._rev, stamp);
  assert.equal((await buildSnapshotAllEntities(env)).quotes[0]._rev, undefined);
  await env.DB.prepare("UPDATE base44_entity_state SET synced_at = ? WHERE local_id = 'live'")
    .bind("2026-01-02T00:00:00.000Z").run();
  assert.notEqual((await buildSnapshotAllEntities(env)).version, desktop.version);
});

test("SOP compare-and-swap rejects stale writes without adding false history", async () => {
  const env = environment();
  const upsert = async (updatedAt, baseUpdatedAt) => {
    const req = await request("/api/sops/upsert", { id: "sop", updatedAt, baseUpdatedAt, record: { title: updatedAt } }, {
      Authorization: "Bearer internal-only", "X-EnQuote-User": await signUserToken(email, secret)
    });
    return (await handleSopsUpsert(req, env)).json();
  };
  const second = "2026-01-02T00:00:00.000Z";
  assert.equal((await upsert(stamp)).applied, true);
  assert.equal((await upsert(second, stamp)).applied, true);
  assert.equal((await upsert("2026-01-03T00:00:00.000Z", stamp)).applied, false);
  const versions = await handleSopsVersions(await request("/api/sops/versions?id=sop", undefined, {
    Authorization: "Bearer internal-only", "X-EnQuote-User": await signUserToken(email, secret)
  }), env);
  assert.equal((await versions.json()).versions.length, 2);
});

test("profile updates allow safe self-edits but reject role escalation and editing other users", async t => {
  const env = environment();
  const headers = { Authorization: "Bearer internal-only", "X-EnQuote-User": await signUserToken(email, secret) };
  const update = async changes => handleProfileUpdate(await request("/api/profiles/update", { id: "alice", changes }, headers), env);
  assert.equal((await update({ app_role: "admin" })).status, 400);
  const other = await handleProfileUpdate(await request("/api/profiles/update", {
    id: "alice", changes: { full_name: "Not Alice" }
  }, { Authorization: "Bearer internal-only", "X-EnQuote-User": await signUserToken("bob@example.com", secret) }), {
    ...env, ALLOWED_EMAILS_LIST: `${email},bob@example.com`
  });
  assert.equal(other.status, 403);
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.method, "PUT");
    assert.deepEqual(JSON.parse(options.body), { full_name: "Alice Updated" });
    return new Response(JSON.stringify({ id: "alice", email, full_name: "Alice Updated" }), {
      headers: { "Content-Type": "application/json" }
    });
  });
  assert.equal((await (await update({ full_name: "Alice Updated" })).json()).record.full_name, "Alice Updated");
});

test("browser entity CRUD confirms remote IDs, keeps desktop revisions clean, and persists deletion tombstones", async t => {
  const env = environment("admin");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return new Response(JSON.stringify({ id: "remote-product" }), { headers: { "Content-Type": "application/json" } });
  });
  const mutate = async body => handleEntityWrite(await request("/api/web-entities", body), env);
  const created = await mutate({ entityType: "Product", action: "create", record: {
    id: "client-product", name: "Test", created_by_id: "forged"
  } });
  assert.equal(created.status, 200);
  const saved = (await created.json()).record;
  assert.equal(saved.id, "remote-product");
  assert.equal(saved.created_by_id, "alice");
  assert.equal(calls[0].method, "POST");
  const stored = await env.DB.prepare("SELECT record_json FROM base44_entity_state WHERE local_id = ?").bind(saved.id).first();
  assert.equal(JSON.parse(stored.record_json)._rev, undefined);
  assert.equal((await mutate({ entityType: "Product", action: "update", expectedVersion: "stale", record: {
    id: saved.id, name: "Stale edit"
  } })).status, 409);
  const deleted = await mutate({ entityType: "Product", action: "delete", record: { id: saved.id } });
  assert.equal(deleted.status, 200);
  assert.equal(calls.at(-1).method, "DELETE");
  assert.equal((await env.DB.prepare("SELECT action FROM base44_entity_state WHERE local_id = ?").bind(saved.id).first()).action, "delete");
});

test("browser entity writes enforce roles and never confirm failed remote saves", async t => {
  const payload = { entityType: "Product", action: "create", record: { name: "Not saved" } };
  assert.equal((await handleEntityWrite(await request("/api/web-entities", payload), environment())).status, 403);
  const env = environment("admin");
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const failed = await handleEntityWrite(await request("/api/web-entities", payload), env);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).ok, false);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM base44_entity_state").first()).count, 0);
});

test("legacy lowercase quote rows never appear as extra quotes in the shared snapshot", async () => {
  const env = environment();
  const insert = (type, id, record) => env.DB.prepare(
    "INSERT INTO base44_entity_state VALUES (?, ?, 'create', ?, 'test', ?)"
  ).bind(type, id, JSON.stringify(record), stamp).run();
  await insert("Quote", "real-1", { id: "real-1", quote_number: "Q-1" });
  await insert("quote", "demo-quote-1", { id: "demo-quote-1", quote_number: "Q-1" });
  assert.deepEqual((await buildSnapshotAllEntities(env)).quotes.map(item => item.id), ["real-1"]);
});

test("desktop shared-collection pushes are stored under the Base44 id so browsers see them immediately", async t => {
  const env = { ...environment(), BASE44_API_URL: "https://example.base44.app", BASE44_APP_ID: "app", BASE44_API_KEY: "key" };
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(JSON.parse(options.body).id, undefined);
    return new Response(JSON.stringify({ id: "b44-flag" }), { headers: { "Content-Type": "application/json" } });
  });
  const push = body => handleInboundBase44(new Request("https://enquote.example/api/inbound/base44", {
    method: "POST", headers: { Authorization: "Bearer internal-only", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), env);
  const result = await (await push({ entityType: "SiteFlag", action: "create", localId: "demo-siteFlags-1", remoteId: null,
    record: { site_id: "S-1", level: 2 } })).json();
  assert.equal(result.remote_id, "b44-flag");
  const row = await env.DB.prepare("SELECT action, record_json, origin FROM base44_entity_state WHERE entity_type = 'SiteFlag' AND local_id = 'b44-flag'").first();
  assert.equal(row.origin, "desktop");
  assert.deepEqual(JSON.parse(row.record_json).site_id, "S-1");
  assert.equal(JSON.parse(row.record_json).id, "b44-flag");
  const snapshot = await buildSnapshotAllEntities(env);
  assert.deepEqual(snapshot.siteFlags.map(item => item.id), ["b44-flag"]);
});
