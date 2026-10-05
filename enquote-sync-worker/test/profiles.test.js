import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminD1 } from "../test-helpers/d1Shim.js";
import { signUserToken } from "../src/user-token.js";
import {
  handleProfileAvatarDownload,
  handleProfileAvatarRemove,
  handleProfileAvatarUpload,
  handleProfilesList
} from "../src/profiles.js";

const SECRET = "01234567890123456789012345678901";
const OUTBOUND_TOKEN = "outbound-token";

function makeKv() {
  const data = new Map();
  return {
    async put(key, value, options = {}) { data.set(key, { value, metadata: options.metadata || null }); },
    async getWithMetadata(key) {
      const item = data.get(key);
      return item ? { value: item.value, metadata: item.metadata } : { value: null, metadata: null };
    },
    data
  };
}

function makeEnv() {
  const broadcasts = [];
  return {
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST: "alice@example.com,bob@example.com",
    DB: createAdminD1(),
    CACHE: makeKv(),
    broadcasts,
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (_url, init) => { broadcasts.push(JSON.parse(init.body)); return new Response("{}"); } })
    }
  };
}

async function authedRequest(path, email, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Authorization: "Bearer " + OUTBOUND_TOKEN,
      "X-EnQuote-User": await signUserToken(email, SECRET),
      ...headers
    },
    ...(body ? { body } : {})
  });
}

test("profiles list avatars, upload bytes to KV, download, remove, and broadcast", async () => {
  const env = makeEnv();
  const bytes = new TextEncoder().encode("avatar").buffer;
  const uploaded = await (await handleProfileAvatarUpload(await authedRequest("/api/profiles/avatar", "alice@example.com", {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": "image/webp" }
  }), env)).json();
  assert.equal(uploaded.ok, true);
  assert.match(uploaded.avatarId, /^[a-f0-9]{64}$/);
  assert.deepEqual(env.broadcasts[0], { type: "profiles_updated" });

  const list = await (await handleProfilesList(await authedRequest("/api/profiles", "bob@example.com"), env)).json();
  assert.deepEqual(list.profiles, [{ email: "alice@example.com", avatarId: uploaded.avatarId, updatedAt: list.profiles[0].updatedAt }]);

  const download = await handleProfileAvatarDownload(await authedRequest(`/api/profiles/avatar/${uploaded.avatarId}`, "bob@example.com"), env, uploaded.avatarId);
  assert.equal(download.headers.get("Content-Type"), "image/webp");
  assert.equal(new TextDecoder().decode(await download.arrayBuffer()), "avatar");

  assert.equal((await handleProfileAvatarUpload(await authedRequest("/api/profiles/avatar", "alice@example.com", {
    method: "POST",
    body: bytes,
    headers: { "Content-Type": "image/gif" }
  }), env)).status, 415);
  assert.equal((await handleProfileAvatarUpload(await authedRequest("/api/profiles/avatar", "alice@example.com", {
    method: "POST",
    body: new ArrayBuffer(512 * 1024 + 1),
    headers: { "Content-Type": "image/png" }
  }), env)).status, 413);

  assert.deepEqual(await (await handleProfileAvatarRemove(await authedRequest("/api/profiles/avatar/remove", "alice@example.com", { method: "POST" }), env)).json(), { ok: true });
  const empty = await (await handleProfilesList(await authedRequest("/api/profiles", "alice@example.com"), env)).json();
  assert.deepEqual(empty.profiles, []);
});
