import assert from "node:assert/strict";
import { test } from "node:test";
import { handleInboundBase44 } from "../src/inbound.js";

const OUTBOUND_TOKEN = "outbound-test-token";

function makeDatabase() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const query = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          statements.push({ sql: this.sql, values: this.values });
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        }
      };
      return query;
    }
  };
}

function makeRequest(body, authorization = `Bearer ${OUTBOUND_TOKEN}`) {
  return new Request("https://worker.example/api/inbound/base44", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("deletes remotely, records a tombstone, refreshes cache, and broadcasts", async () => {
  const db = makeDatabase();
  const fetchCalls = [];
  const cacheWrites = [];
  const broadcasts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: init.method });
    if (init.method === "GET") return Response.json({ id: "base44-quote-1" });
    return new Response(null, { status: 204 });
  };
  const env = {
    OUTBOUND_TOKEN,
    BASE44_API_URL: "https://example.base44.app",
    BASE44_APP_ID: "app-1",
    BASE44_API_KEY: "api-key",
    SNAPSHOT_TOKEN: "snapshot-test-token",
    DB: db,
    CACHE: {
      async put(key, value) {
        cacheWrites.push({ key, snapshot: JSON.parse(value) });
      }
    },
    QUOTE_SYNC_ROOM: {
      idFromName: name => name,
      get: () => ({
        async fetch(_url, init) {
          broadcasts.push(JSON.parse(init.body));
          return new Response(null, { status: 200 });
        }
      })
    }
  };

  try {
    const response = await handleInboundBase44(makeRequest({
      entityType: "quote",
      action: "delete",
      localId: "base44-quote-1",
      remoteId: "base44-quote-1"
    }), env);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "deleted",
      remote_id: "base44-quote-1",
      conflict_with: null
    });
    assert.deepEqual(fetchCalls.map(({ method }) => method), ["GET", "DELETE"]);
    assert.ok(db.statements.some(({ sql, values }) =>
      /INSERT INTO base44_entity_state/.test(sql) &&
      values[0] === "base44-quote-1" &&
      /'delete'/.test(sql)
    ));
    assert.ok(db.statements.some(({ sql, values }) =>
      /DELETE FROM quotes/.test(sql) && values[0] === "base44-quote-1"
    ));
    assert.deepEqual(cacheWrites[0].snapshot, { quotes: [], lastSavedAt: null });
    assert.deepEqual(broadcasts, [{
      type: "quotes_updated",
      quoteCount: 0,
      lastSavedAt: null
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unauthorized deletion before accessing Base44 or D1", async () => {
  const db = makeDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Base44 must not be called for an unauthorized request.");
  };

  try {
    const response = await handleInboundBase44(makeRequest({
      entityType: "quote",
      action: "delete",
      localId: "base44-quote-1",
      remoteId: "base44-quote-1"
    }, "Bearer invalid"), {
      OUTBOUND_TOKEN,
      DB: db
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.deepEqual(db.statements, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
