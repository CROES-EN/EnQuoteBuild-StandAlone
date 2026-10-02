import assert from "node:assert/strict";
import { test } from "node:test";
import { readSnapshotCache, refreshSnapshotCache } from "../src/snapshot-cache.js";

function createDatabase() {
  let reads = 0;
  return {
    get reads() { return reads; },
    prepare(sql) {
      return {
        async all() {
          reads += 1;
          assert.match(sql, /SELECT payload, updated_at FROM quotes/);
          return { results: [{ payload: JSON.stringify({ id: "quote-1" }), updated_at: "2026-10-01T12:00:00Z" }] };
        },
        async first() {
          reads += 1;
          assert.match(sql, /SELECT updated_at FROM quotes/);
          return { updated_at: "2026-10-01T12:00:00Z" };
        }
      };
    }
  };
}

function createKv() {
  const values = new Map();
  return {
    values,
    async get(key, options) {
      assert.deepEqual(options, { type: "json" });
      return values.has(key) ? JSON.parse(values.get(key)) : null;
    },
    async put(key, value) {
      values.set(key, value);
    }
  };
}

test("fills KV from D1 and reuses the cached quote snapshot", async () => {
  const DB = createDatabase();
  const CACHE = createKv();
  const env = { DB, CACHE };

  const first = await readSnapshotCache(env);
  const second = await readSnapshotCache(env);

  assert.deepEqual(first, {
    quotes: [{ id: "quote-1", _synced_at: "2026-10-01T12:00:00Z" }],
    lastSavedAt: "2026-10-01T12:00:00Z"
  });
  assert.deepEqual(second, first);
  assert.equal(DB.reads, 2);
});

test("refreshes the KV cache after a source update", async () => {
  const DB = createDatabase();
  const CACHE = createKv();
  const snapshot = await refreshSnapshotCache({ DB, CACHE });

  assert.equal(snapshot.quotes.length, 1);
  assert.equal(CACHE.values.has("quote-snapshot-v1"), true);
});
