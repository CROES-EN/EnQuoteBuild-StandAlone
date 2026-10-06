import test from "node:test";
import assert from "node:assert/strict";
import {handleRetro} from "../src/Base44_DTO.js";
import {signUserToken} from "../src/user-token.js";

test("shared retro profiles require auth, persist code, paginate, and only write the caller's profile", async () => {
  const entries = new Map();
  const env = {
    USER_TOKEN_SECRET: "01234567890123456789012345678901",
    OUTBOUND_TOKEN: "test-token", ALLOWED_EMAILS_LIST: "alice@example.com,bob@example.com",
    CACHE: {
      get: async (key) => entries.get(key)?.value ? JSON.parse(entries.get(key).value) : null,
      put: async (key, value, options) => entries.set(key, {value, metadata: options.metadata}),
      delete: async (key) => entries.delete(key),
      list: async () => ({keys: [...entries].map(([name, item]) => ({name, metadata: item.metadata})), list_complete: true})
    }
  };
  async function request(email, method = "GET", value, search = "") {
    return new Request(`https://test.invalid/api/Base44_DTO${search}`, {
      method, headers: {Authorization: "Bearer test-token", "X-EnQuote-User": await signUserToken(email, env.USER_TOKEN_SECRET)},
      ...(value !== undefined ? {body: JSON.stringify(value)} : {})
    });
  }
  assert.equal((await handleRetro(new Request("https://test.invalid/api/Base44_DTO"), env)).status, 401);
  const code = {name: "Alice", mood: "Retro", html: "<h1>Hello</h1>", css: "body{color:pink}", email: "bob@example.com"};
  assert.equal((await handleRetro(await request("alice@example.com", "POST", code), env)).status, 200);
  const list = await (await handleRetro(await request("bob@example.com"), env)).json();
  assert.equal(list.profiles[0].email, "alice@example.com");
  assert.equal(list.cursor, null);
  const read = await (await handleRetro(await request("bob@example.com", "GET", undefined, "?email=alice@example.com"), env)).json();
  assert.equal(read.profile.html, code.html);
  assert.equal(read.profile.css, code.css);
  const editable = {...code, layout: "classic", appearance: "gothic", about: "My editable biography", music: "Jazz", heroes: "Friends"};
  const saved = await (await handleRetro(await request("alice@example.com", "POST", editable), env)).json();
  assert.equal(saved.profile.layout, "classic");
  assert.equal(saved.profile.appearance, "gothic");
  const restored = await (await handleRetro(await request("bob@example.com", "GET", undefined, "?email=alice@example.com"), env)).json();
  assert.equal(restored.profile.about, editable.about);
  assert.equal(restored.profile.music, "Jazz");
  assert.equal((await handleRetro(await request("alice@example.com", "POST", {...editable, about: {invalid: true}}), env)).status, 400);
  assert.equal((await handleRetro(await request("alice@example.com", "POST", {...editable, appearance: "unknown"}), env)).status, 400);
  assert.equal((await (await handleRetro(await request("alice@example.com", "POST", {...editable, appearance: "imported-raw"}), env)).json()).profile.appearance, "imported-raw");
  await handleRetro(await request("bob@example.com", "DELETE"), env);
  assert.equal(entries.size, 1);
  assert.equal((await handleRetro(await request("alice@example.com", "POST", {...code, html: "x".repeat(65536)}), env)).status, 413);
  assert.equal((await handleRetro(await request("alice@example.com", "POST", {...code, name: ""}), env)).status, 400);
  await handleRetro(await request("alice@example.com", "DELETE"), env);
  assert.equal(entries.size, 0);
});
