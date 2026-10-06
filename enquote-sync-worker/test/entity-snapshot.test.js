import assert from "node:assert/strict";
import { test } from "node:test";
import { handleEntitySnapshot } from "../src/entity-snapshot.js";

const SNAPSHOT_TOKEN = "snapshot-test-token";
const AUTHORIZATION_HEADER = "Bearer snapshot-test-token";

function createEntityDatabase(records) {
  const offsets = [];
  return {
    offsets,
    prepare(sql) {
      if (/MAX\(synced_at\)/.test(sql)) {
        return {
          async first() {
            const stamps = records.map((row) => row.synced_at).sort();
            return { version: stamps.at(-1) ?? null };
          }
        };
      }
      assert.match(sql, /json_group_array\(json_object/);
      assert.match(sql, /json_valid\(record_json\)/);
      let limit;
      let offset;
      return {
        bind(pageLimit, pageOffset) {
          limit = pageLimit;
          offset = pageOffset;
          return this;
        },
        async all() {
          offsets.push(offset);
          const page = records.slice(offset, offset + limit);
          const entities = page.map((row) => {
            let record = {};
            try {
              record = JSON.parse(row.record_json);
            } catch {
              record = {};
            }
            return {
              entityType: row.entity_type,
              localId: row.local_id,
              action: row.action,
              record,
              syncedAt: row.synced_at
            };
          });
          return {
            results: [{
              row_count: page.length,
              entities_json: JSON.stringify(entities)
            }]
          };
        }
      };
    }
  };
}

function makeRequest(authorization = AUTHORIZATION_HEADER, ifNoneMatch = null) {
  const headers = new Headers([["Authorization", authorization]]);
  if (ifNoneMatch) headers.set("If-None-Match", ifNoneMatch);
  return new Request("https://enquote-sync.example.workers.dev/api/base44/webhook/entity-snapshot", {
    headers
  });
}

test("entity snapshot answers 304 without reading rows when the app already has the version", async () => {
  const records = [{
    entity_type: "Product",
    local_id: "p-1",
    action: "upsert",
    record_json: "{}",
    synced_at: "2026-10-01T00:00:00.000Z"
  }];
  const DB = createEntityDatabase(records);
  const first = await handleEntitySnapshot(makeRequest(), { SNAPSHOT_TOKEN, DB });
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  await first.json();

  const offsetsBefore = DB.offsets.length;
  const second = await handleEntitySnapshot(makeRequest(AUTHORIZATION_HEADER, etag), { SNAPSHOT_TOKEN, DB });
  assert.equal(second.status, 304);
  assert.equal(DB.offsets.length, offsetsBefore);

  records.push({ ...records[0], local_id: "p-2", synced_at: "2026-10-02T00:00:00.000Z" });
  const third = await handleEntitySnapshot(makeRequest(AUTHORIZATION_HEADER, etag), { SNAPSHOT_TOKEN, DB });
  assert.equal(third.status, 200);
  assert.notEqual(third.headers.get("ETag"), etag);
  assert.equal((await third.json()).entities.length, 2);
});

test("entity snapshot pages and SQL-encodes rows without changing the response shape", async () => {
  const records = Array.from({ length: 205 }, (_, index) => ({
    entity_type: index === 204 ? "Product" : "Quote",
    local_id: `record-${index}`,
    action: "upsert",
    record_json: JSON.stringify({ id: `record-${index}`, index }),
    synced_at: `2026-10-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`
  }));
  records[17].record_json = "{malformed";
  const DB = createEntityDatabase(records);

  const response = await handleEntitySnapshot(makeRequest(), {
    SNAPSHOT_TOKEN,
    DB
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.entities.length, 205);
  assert.deepEqual(DB.offsets, [0, 100, 200, 205]);
  assert.deepEqual(body.entities[0], {
    entityType: "Quote",
    localId: "record-0",
    action: "upsert",
    record: { id: "record-0", index: 0 },
    syncedAt: records[0].synced_at
  });
  assert.deepEqual(body.entities[17].record, {});
  assert.equal(body.entities[204].entityType, "Product");
  assert.match(body.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("entity snapshot rejects unauthorized requests without querying D1", async () => {
  let queried = false;
  const response = await handleEntitySnapshot(makeRequest("Bearer wrong-token"), {
    SNAPSHOT_TOKEN,
    DB: {
      prepare() {
        queried = true;
        throw new Error("D1 should not be queried for unauthorized requests.");
      }
    }
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(queried, false);
});
