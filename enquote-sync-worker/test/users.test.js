import assert from "node:assert/strict";
import { test } from "node:test";
import { handleUsers, toPublicUser } from "../src/users.js";

function makeEnv() {
  const store = new Map();
  return {
    OUTBOUND_TOKEN: "t",
    BASE44_API_URL: "https://base44.example",
    BASE44_APP_ID: "app1",
    BASE44_API_KEY: "key",
    CACHE: {
      async get(key) { return store.has(key) ? JSON.parse(store.get(key)) : null; },
      async put(key, value) { store.set(key, value); }
    },
    store
  };
}

const request = (token = "t") => new Request("https://w.example/api/users", { headers: { Authorization: `Bearer ${token}` } });

test("requires the token", async () => {
  const response = await handleUsers(request("wrong"), makeEnv());
  assert.equal(response.status, 401);
});

test("fetches from Base44, trims fields, lowercases email, then serves from cache", async () => {
  const env = makeEnv();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.match(String(url), /\/api\/apps\/app1\/entities\/User/);
    assert.equal(init.headers.api_key, "key");
    return new Response(JSON.stringify([
      { id: "u1", email: "HMackey@Enphaseenergy.com", full_name: "Heather Mackey", app_role: "admin", secret_field: "x", created_by: "y" },
      { id: "u2", email: "", app_role: "admin" }
    ]), { status: 200 });
  };

  const first = await (await handleUsers(request(), env)).json();
  assert.equal(first.users.length, 1);
  assert.equal(first.users[0].email, "hmackey@enphaseenergy.com");
  assert.equal(first.users[0].app_role, "admin");
  assert.deepEqual(first.users[0].additional_roles, []);
  assert.equal("secret_field" in first.users[0], false);

  const second = await (await handleUsers(request(), env)).json();
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test("serves the last good list when Base44 is down, and 502s when there is none", async () => {
  const env = makeEnv();
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  const none = await handleUsers(request(), env);
  assert.equal(none.status, 502);

  env.store.set("users:v1", JSON.stringify({ fetchedAt: 1, users: [toPublicUser({ id: "u1", email: "a@b.com", app_role: "admin" })] }));
  const stale = await (await handleUsers(request(), env)).json();
  assert.equal(stale.stale, true);
  assert.equal(stale.users[0].email, "a@b.com");
});
