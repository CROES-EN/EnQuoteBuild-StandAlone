import assert from "node:assert/strict";
import { test } from "node:test";
import { readSnapshotCache, refreshSnapshotCache } from "../src/snapshot-cache.js";

function createDatabase(state = { lastEventAt: "2026-10-01T12:00:00Z" }) {
  let fullReads = 0;
  let versionReads = 0;
  return {
    state,
    get fullReads() { return fullReads; },
    get versionReads() { return versionReads; },
    prepare(sql) {
      return {
        async all() {
          fullReads += 1;
          assert.match(sql, /SELECT payload, updated_at FROM quotes/);
          return { results: [{ payload: JSON.stringify({ id: "quote-1" }), updated_at: "2026-10-01T12:00:00Z" }] };
        },
        async first() {
          versionReads += 1;
          assert.match(sql, /COUNT\(\*\) FROM quotes/);
          return { quote_count: 1, last_saved_at: "2026-10-01T12:00:00Z", last_event_at: state.lastEventAt };
        }
      };
    }
  };
}

function createKv() {
  const values = new Map();
  let puts = 0;
  return {
    values,
    get puts() { return puts; },
    async get(key, options) {
      assert.deepEqual(options, { type: "json" });
      return values.has(key) ? JSON.parse(values.get(key)) : null;
    },
    async put(key, value) {
      puts += 1;
      values.set(key, value);
    }
  };
}

test("fills KV from D1 once and reuses it while the quotes are unchanged", async () => {
  const DB = createDatabase();
  const CACHE = createKv();
  const env = { DB, CACHE };

  const first = await readSnapshotCache(env);
  const second = await readSnapshotCache(env);

  assert.deepEqual(first.quotes, [{ id: "quote-1", _synced_at: "2026-10-01T12:00:00Z" }]);
  assert.equal(first.lastSavedAt, "2026-10-01T12:00:00Z");
  assert.deepEqual(second, first);
  assert.equal(DB.fullReads, 1);
  assert.equal(CACHE.puts, 1);
});

test("rebuilds the cache when a new webhook changes the version", async () => {
  const DB = createDatabase();
  const CACHE = createKv();
  const env = { DB, CACHE };

  await readSnapshotCache(env);
  DB.state.lastEventAt = "2026-10-01T13:00:00Z";
  await readSnapshotCache(env);
  await readSnapshotCache(env);

  assert.equal(DB.fullReads, 2);
  assert.equal(CACHE.puts, 2);
});

test("refreshSnapshotCache writes the current snapshot to KV", async () => {
  const DB = createDatabase();
  const CACHE = createKv();
  const snapshot = await refreshSnapshotCache({ DB, CACHE });

  assert.equal(snapshot.quotes.length, 1);
  assert.equal(CACHE.values.has("quote-snapshot-v2"), true);
});
