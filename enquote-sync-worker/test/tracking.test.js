import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createSupervisorD1 } from "../test-helpers/d1Shim.js";
import { signUserToken } from "../src/user-token.js";
import { publicQuoteStatus } from "../src/tracking.js";
import worker from "../src/index.js";

const email = "coordinator@example.com";
const secret = "tracking-test-secret-0123456789abcdef";
const origin = "https://enquote.example";

function environment() {
  const DB = createSupervisorD1([
    { sql: readFileSync(new URL("../schema.sql", import.meta.url), "utf8") },
    "0018_tracking_links.sql"
  ]);
  return { DB, USER_TOKEN_SECRET: secret, OUTBOUND_TOKEN: "outbound", ALLOWED_EMAILS_LIST: email };
}

const quote = {
  id: "b44-quote-1", quote_number: "Q-1001", site_id: "SITE 4242", case_number: "CASE-9", status: "invoiced",
  total: 1800, notes: "internal", customer_name: "Pat Homeowner", created_date: "2026-10-01T10:00:00.000Z",
  updated_date: "2026-10-06T10:00:00.000Z",
  status_history: [
    { status: "draft_without_internal", changed_at: "2026-10-01T10:00:00.000Z", changed_by: "a@example.com", notes: "x" },
    { status: "submitted", changed_at: "2026-10-02T10:00:00.000Z", changed_by: "a@example.com" },
    { status: "rejected", changed_at: "2026-10-02T12:00:00.000Z", changed_by: "b@example.com", notes: "pricing" },
    { status: "quote_sent_to_ho", changed_at: "2026-10-03T10:00:00.000Z", changed_by: "a@example.com" },
    { status: "ho_approved_invoice_required", changed_at: "2026-10-05T10:00:00.000Z" },
    { status: "invoiced", changed_at: "2026-10-06T10:00:00.000Z" }
  ]
};

async function seedQuote(env, record = quote) {
  await env.DB.prepare("INSERT INTO base44_entity_state VALUES ('Quote', ?, 'update', ?, 'base44', ?)")
    .bind(record.id, JSON.stringify(record), record.updated_date).run();
}

async function staff(path, body) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer outbound", "X-EnQuote-User": await signUserToken(email, secret), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), this);
}

function publicRequest(path, { body, cookie, headers = {} } = {}) {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test("homeowner status hides internal steps and exposes only friendly fields", () => {
  const status = publicQuoteStatus(quote);
  assert.deepEqual(Object.keys(status).sort(), ["nextStep", "quoteNumber", "stage", "status", "timeline"]);
  assert.equal(status.status, "Invoice sent");
  assert.match(status.nextStep, /pay the invoice/);
  assert.deepEqual(status.timeline.map(step => step.label), ["Preparing your quote", "Quote sent to you", "Quote accepted", "Invoice sent"]);
  assert.equal(status.timeline[1].date, "2026-10-03T10:00:00.000Z");
  const serialized = JSON.stringify(status);
  for (const secretValue of ["1800", "internal", "Pat Homeowner", "CASE-9", "SITE 4242", "example.com", "pricing", "Rejected"]) {
    assert.equal(serialized.includes(secretValue), false, secretValue);
  }
});

test("staff create one reusable link; homeowners need the site ID; revoking disables it", async () => {
  const env = environment();
  const call = staff.bind(env);
  assert.equal((await call("/api/tracking-links/create", { quoteId: "missing" })).status, 404);
  await seedQuote(env);
  const created = await (await call("/api/tracking-links/create", { quoteId: quote.id })).json();
  assert.match(created.link.url, /^https:\/\/enquote\.example\/track\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  const again = await (await call("/api/tracking-links/create", { quoteId: quote.id })).json();
  assert.equal(again.link.url, created.link.url);
  assert.equal((await (await call(`/api/tracking-links?quoteId=${quote.id}`)).json()).link.url, created.link.url);
  const stored = await env.DB.prepare("SELECT id FROM tracking_links").first();
  assert.equal(created.link.url.includes(stored.id), true);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM tracking_links").first()).n, 1);

  const path = new URL(created.link.url).pathname;
  const page = await worker.fetch(publicRequest(path), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await page.text();
  assert.equal(html.includes("Q-1001"), false, "the page itself never contains quote data");

  assert.equal((await worker.fetch(publicRequest(`${path}/status`), env)).status, 401);
  const wrong = await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "nope" } }), env);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);
  const crossSite = await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "site4242" }, headers: { Origin: "https://evil.example" } }), env);
  assert.equal(crossSite.status, 403);

  const verified = await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: " site4242 " } }), env);
  assert.equal(verified.status, 200);
  const body = await verified.json();
  assert.equal(body.quote.quoteNumber, "Q-1001");
  assert.equal(JSON.stringify(body).includes("1800"), false);
  const cookie = verified.headers.get("set-cookie");
  assert.match(cookie, /^__Host-enquote_track=.+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/);
  const session = cookie.split(";")[0];
  assert.equal((await worker.fetch(publicRequest(`${path}/status`, { cookie: session }), env)).status, 200);

  const forged = path.replace(/.$/, path.endsWith("A") ? "B" : "A");
  assert.equal((await worker.fetch(publicRequest(`${forged}/verify`, { body: { siteId: "site4242" } }), env)).status, 404);

  assert.equal((await (await call("/api/tracking-links/revoke", { quoteId: quote.id })).json()).revoked, 1);
  assert.equal((await worker.fetch(publicRequest(`${path}/status`, { cookie: session }), env)).status, 404);
  assert.equal((await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "site4242" } }), env)).status, 404);
  const replacement = await (await call("/api/tracking-links/create", { quoteId: quote.id })).json();
  assert.notEqual(replacement.link.url, created.link.url);
});

test("site ID guessing is rate limited per link and deleted quotes deactivate links", async () => {
  const env = environment();
  await seedQuote(env);
  const { link } = await (await staff.call(env, "/api/tracking-links/create", { quoteId: quote.id })).json();
  const path = new URL(link.url).pathname;
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: `guess-${attempt}` } }), env)).status, 401);
  }
  const locked = await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "site4242" } }), env);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get("retry-after")) > 0);

  await env.DB.prepare("UPDATE tracking_links SET failed_window_start = ?").bind("2000-01-01T00:00:00.000Z").run();
  assert.equal((await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "site4242" } }), env)).status, 200);
  await env.DB.prepare("UPDATE base44_entity_state SET action = 'delete', record_json = '{}' WHERE local_id = ?").bind(quote.id).run();
  assert.equal((await worker.fetch(publicRequest(`${path}/verify`, { body: { siteId: "site4242" } }), env)).status, 404);
});

test("tracking-link management requires a signed-in staff user", async () => {
  const env = environment();
  await seedQuote(env);
  const anonymous = await worker.fetch(new Request(`${origin}/api/tracking-links/create`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: quote.id })
  }), env);
  assert.equal(anonymous.status, 401);
  for (const path of ["/track", "/track/", "/track/a/b", "/track/x/index.html", "/track/x/../../api/users"]) {
    const response = await worker.fetch(new Request(`${origin}${path}`), env);
    assert.equal(response.headers.get("content-type")?.includes("text/html") && response.status === 200, false, path);
    assert.notEqual(response.status, 200, path);
  }
});
