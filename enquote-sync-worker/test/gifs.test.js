import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAdminD1 } from "../test-helpers/d1Shim.js";
import { signUserToken } from "../src/user-token.js";
import { handleGifsSearch, handleGifsTrending } from "../src/gifs.js";

const SECRET = "01234567890123456789012345678901";
const OUTBOUND_TOKEN = "outbound-token";
const originalFetch = globalThis.fetch;

function makeKv() {
  const data = new Map();
  return {
    async put(key, value, options = {}) { data.set(key, { value, metadata: options.metadata || null }); },
    async get(key, type) {
      const item = data.get(key);
      if (!item) return null;
      return type === "json" ? JSON.parse(item.value) : item.value;
    },
    data
  };
}

function makeEnv(extra = {}) {
  return {
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST: "alice@example.com",
    GIPHY_API_KEY: "secret-key",
    DB: createAdminD1(),
    CACHE: makeKv(),
    ...extra
  };
}

async function authedRequest(path, email = "alice@example.com") {
  return new Request(`https://worker.example${path}`, {
    headers: {
      Authorization: "Bearer " + OUTBOUND_TOKEN,
      "X-EnQuote-User": await signUserToken(email, SECRET)
    }
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("GIPHY search proxies safe fields, caches, paginates, and never returns the API key", async () => {
  const env = makeEnv();
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("api_key"), "secret-key");
    assert.equal(parsed.searchParams.get("rating"), "pg");
    assert.equal(parsed.searchParams.get("limit"), "24");
    return new Response(JSON.stringify({
      data: [{
        id: "abc",
        title: "Wave",
        images: {
          fixed_height: { url: "https://media2.giphy.com/media/abc/200.gif", width: "200", height: "120" },
          fixed_width_small: { webp: "https://media2.giphy.com/media/abc/100w.webp" }
        }
      }, {
        id: "bad",
        title: "Bad",
        images: { fixed_height: { url: "https://example.com/bad.gif", width: "1", height: "1" } }
      }],
      pagination: { count: 24, offset: 0, total_count: 30 }
    }), { headers: { "Content-Type": "application/json" } });
  };

  const first = await (await handleGifsSearch(await authedRequest("/api/gifs/search?q=hello&offset=0"), env)).json();
  assert.equal(first.ok, true);
  assert.equal(first.gifs.length, 1);
  assert.deepEqual(first.gifs[0], {
    id: "abc",
    title: "Wave",
    url: "https://media2.giphy.com/media/abc/200.gif",
    previewUrl: "https://media2.giphy.com/media/abc/100w.webp",
    width: 200,
    height: 120
  });
  assert.equal(first.nextOffset, 24);
  assert.equal(JSON.stringify(first).includes("secret-key"), false);

  const second = await (await handleGifsSearch(await authedRequest("/api/gifs/search?q=hello&offset=0"), env)).json();
  assert.equal(second.gifs[0].id, "abc");
  assert.equal(urls.length, 1);
});

test("GIPHY trending requires configuration and uses trending endpoint", async () => {
  assert.equal((await handleGifsTrending(await authedRequest("/api/gifs/trending"), makeEnv({ GIPHY_API_KEY: "" }))).status, 503);
  const env = makeEnv();
  let called = "";
  globalThis.fetch = async (url) => {
    called = String(url);
    return new Response(JSON.stringify({ data: [], pagination: { count: 0, total_count: 0 } }), { headers: { "Content-Type": "application/json" } });
  };
  const body = await (await handleGifsTrending(await authedRequest("/api/gifs/trending?offset=48"), env)).json();
  assert.equal(body.ok, true);
  assert.match(called, /\/v1\/gifs\/trending/);
  assert.match(called, /offset=48/);
});
