import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupervisorD1 } from "../test-helpers/d1Shim.js";
import { handlePreferencesList, handlePreferencesUpsert } from "../src/preferences.js";
import { inboxKeyForEmail, signUserToken } from "../src/user-token.js";

const SECRET = "01234567890123456789012345678901";
const OUTBOUND_TOKEN = "outbound-token";

function makeEnv() {
  const broadcasts = [];
  return {
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST: "alice@example.com,bob@example.com",
    DB: createSupervisorD1(["0017_user_preferences.sql"]),
    broadcasts,
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (_url, init) => { broadcasts.push(JSON.parse(init.body)); return new Response("{}"); } })
    }
  };
}

async function request(path, email, body) {
  return new Request(`https://worker.example${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${OUTBOUND_TOKEN}`,
      "X-EnQuote-User": await signUserToken(email, SECRET),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const list = async (env, email, since = "") =>
  (await handlePreferencesList(await request(`/api/preferences${since ? `?since=${since}` : ""}`, email), env)).json();
const save = async (env, email, entries) =>
  handlePreferencesUpsert(await request("/api/preferences/upsert", email, { entries }), env);

test("preferences are private per user, newest change wins, deletions persist, and broadcasts hide email", async () => {
  const env = makeEnv();
  let response = await save(env, "alice@example.com", [
    { key: "enquote_selected_theme_v1", updatedAt: at(-30_000), value: "dark-plus" },
    { key: "enquote_sidebar_collapsed", updatedAt: at(-30_000), value: "1" }
  ]);
  assert.deepEqual(await response.json(), { ok: true, applied: ["enquote_selected_theme_v1", "enquote_sidebar_collapsed"] });
  assert.deepEqual(env.broadcasts, [{ type: "preferences_updated", key: await inboxKeyForEmail("alice@example.com", SECRET) }]);
  assert.equal(JSON.stringify(env.broadcasts).includes("alice"), false);

  response = await save(env, "alice@example.com", [{ key: "enquote_selected_theme_v1", updatedAt: at(-60_000), value: "stale" }]);
  assert.deepEqual((await response.json()).applied, []);
  assert.equal(env.broadcasts.length, 1);

  const first = await list(env, "alice@example.com");
  assert.equal(first.preferences.find((item) => item.key === "enquote_selected_theme_v1").value, "dark-plus");
  assert.deepEqual((await list(env, "bob@example.com")).preferences, []);
  assert.deepEqual((await list(env, "alice@example.com", first.cursor)).preferences, []);

  await new Promise((resolve) => setTimeout(resolve, 5));
  await save(env, "alice@example.com", [{ key: "enquote_sidebar_collapsed", updatedAt: at(-1_000), value: null }]);
  const delta = await list(env, "alice@example.com", first.cursor);
  assert.deepEqual(delta.preferences, [{ key: "enquote_sidebar_collapsed", updatedAt: delta.preferences[0].updatedAt, deleted: true, value: null }]);

  response = await save(env, "alice@example.com", [{ key: "enquote_sidebar_collapsed", updatedAt: at(-20_000), value: "0" }]);
  assert.deepEqual((await response.json()).applied, [], "an older write cannot undo a newer deletion");
});

test("preference writes validate keys, values, stamps and limits", async () => {
  const env = makeEnv();
  const bad = async (entries, error, status = 400) => {
    const response = await save(env, "alice@example.com", entries);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, error);
  };
  await bad([], "invalid_entries");
  await bad([{ key: "bad key!", updatedAt: at(0), value: "x" }], "invalid_key");
  await bad([{ key: "theme", updatedAt: "yesterday", value: "x" }], "invalid_stamp");
  await bad([{ key: "theme", updatedAt: at(10 * 60_000), value: "x" }], "stamp_in_future");
  await bad([{ key: "theme", updatedAt: at(0), value: { nested: true } }], "invalid_value");
  await bad([{ key: "theme", updatedAt: at(0), value: "x".repeat(64 * 1024 + 1) }], "value_too_large");
  await bad([{ key: "a", updatedAt: at(0), value: "1" }, { key: "a", updatedAt: at(0), value: "2" }], "duplicate_key");
  for (let batch = 0; batch < 4; batch += 1) {
    const entries = Array.from({ length: 100 }, (_, index) => ({ key: `k${batch}_${index}`, updatedAt: at(-1000), value: "v" }));
    assert.equal((await save(env, "alice@example.com", entries)).status, 200);
  }
  await bad([{ key: "one_more", updatedAt: at(0), value: "v" }], "too_many_preferences", 413);
  assert.equal((await save(env, "alice@example.com", [{ key: "k0_0", updatedAt: at(0), value: "updated" }])).status, 200);

  const unauthenticated = await handlePreferencesList(new Request("https://worker.example/api/preferences"), env);
  assert.equal(unauthenticated.status, 401);
  const stranger = await save(env, "mallory@example.com", [{ key: "theme", updatedAt: at(0), value: "x" }]);
  assert.equal(stranger.status, 403);
});
