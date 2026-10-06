import test from "node:test";
import assert from "node:assert/strict";
import {createAvatarCache} from "../src/features/profiles/avatarCache.js";

test("concurrent avatars share a single download and URL", async () => {
  let downloads = 0;
  let urls = 0;
  const revoked = [];
  const cache = createAvatarCache({
    load: async (id) => { downloads++; return id; },
    createUrl: (id) => { urls++; return `blob:${id}`; },
    revokeUrl: (url) => revoked.push(url),
    maxUnused: 0
  });
  const avatars = await Promise.all(Array.from({length: 100}, () => cache.acquire("same")));
  assert.equal(downloads, 1);
  assert.equal(urls, 1);
  avatars.slice(1).forEach((avatar) => avatar.release());
  assert.deepEqual(revoked, []);
  avatars[0].release();
  avatars[0].release();
  assert.deepEqual(revoked, ["blob:same"]);
});

test("evicts unused URLs while keeping displayed avatars and allows retries", async () => {
  const revoked = [];
  let failing = true;
  const cache = createAvatarCache({
    load: async (id) => {
      if (id === "retry" && failing) throw new Error("Offline");
      return id;
    },
    createUrl: (id) => `blob:${id}`,
    revokeUrl: (url) => revoked.push(url),
    maxUnused: 2
  });
  const active = await cache.acquire("active");
  for (let id = 0; id < 20; id++) (await cache.acquire(String(id))).release();
  assert.equal(revoked.length, 18);
  assert.equal(revoked.includes(active.url), false);
  await assert.rejects(cache.acquire("retry"), /Offline/);
  failing = false;
  const retried = await cache.acquire("retry");
  assert.equal(retried.url, "blob:retry");
  retried.release();
  active.release();
  cache.dispose();
  assert.equal(new Set(revoked).size, 22);
});

test("disposing an in-flight download revokes its eventual URL", async () => {
  let resolveLoad;
  const revoked = [];
  const cache = createAvatarCache({
    load: () => new Promise((resolve) => { resolveLoad = resolve; }),
    createUrl: (id) => `blob:${id}`,
    revokeUrl: (url) => revoked.push(url)
  });
  const pending = cache.acquire("pending");
  await Promise.resolve();
  cache.dispose();
  resolveLoad("pending");
  (await pending).release();
  await Promise.resolve();
  assert.deepEqual(revoked, ["blob:pending"]);
});
