import assert from "node:assert/strict";
import { test } from "node:test";
import { broadcastQuoteUpdate, handleRealtimeSocket, QuoteSyncRoom } from "../src/realtime.js";

const SNAPSHOT_TOKEN = "snapshot-test-token";

test("rejects unauthenticated websocket requests before accessing the Durable Object", async () => {
  let accessed = false;
  const response = await handleRealtimeSocket(
    new Request("https://enquote-sync.example.workers.dev/ws"),
    {
      SNAPSHOT_TOKEN,
      QUOTE_SYNC_ROOM: {
        idFromName() { accessed = true; },
        get() { accessed = true; }
      }
    }
  );

  assert.equal(response.status, 401);
  assert.equal(accessed, false);
});

test("broadcasts quote notifications to connected sockets", async () => {
  const sent = [];
  const room = new QuoteSyncRoom({
    getWebSockets: () => [{ send: (message) => sent.push(message) }]
  }, { SNAPSHOT_TOKEN });

  const response = await room.fetch(new Request("https://room/broadcast", {
    method: "POST",
    headers: { "X-Internal-Sync-Key": SNAPSHOT_TOKEN },
    body: JSON.stringify({ type: "quotes_updated", quoteCount: 2 })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: 1 });
  assert.deepEqual(JSON.parse(sent[0]), { type: "quotes_updated", quoteCount: 2 });
});

test("protects Durable Object broadcast and handles app-level ping", async () => {
  const sent = [];
  const socket = { send: (message) => sent.push(message) };
  const room = new QuoteSyncRoom({ getWebSockets: () => [socket] }, { SNAPSHOT_TOKEN });

  const unauthorized = await room.fetch(new Request("https://room/broadcast", {
    method: "POST",
    body: JSON.stringify({ type: "quotes_updated" })
  }));
  assert.equal(unauthorized.status, 401);

  room.webSocketMessage(socket, "ping");
  assert.deepEqual(sent, ["pong"]);
});

test("forwards authorized WebSocket requests to the named room", async () => {
  let forwarded;
  const response = new Response("upgraded");
  const env = {
    SNAPSHOT_TOKEN,
    QUOTE_SYNC_ROOM: {
      idFromName(name) {
        assert.equal(name, "enquote-quotes");
        return "room-id";
      },
      get(id) {
        assert.equal(id, "room-id");
        return { fetch: async (request) => { forwarded = request; return response; } };
      }
    }
  };

  const result = await handleRealtimeSocket(new Request("https://worker/ws", {
    headers: {
      "X-ENQuote-Shared-Secret": SNAPSHOT_TOKEN,
      Upgrade: "websocket"
    }
  }), env);

  assert.equal(result, response);
  assert.equal(forwarded.headers.get("X-ENQuote-Shared-Secret"), SNAPSHOT_TOKEN);
});

test("reports a missing Durable Object binding clearly", async () => {
  const response = await handleRealtimeSocket(
    new Request("https://worker/ws", { headers: { "X-ENQuote-Shared-Secret": SNAPSHOT_TOKEN } }),
    { SNAPSHOT_TOKEN }
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "realtime_not_configured" });
});

test("broadcast helper targets the shared Durable Object room", async () => {
  let sentRequest;
  const env = {
    SNAPSHOT_TOKEN,
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (input, init) => {
          sentRequest = { input, init };
          return new Response("{}", { status: 200 });
        }
      })
    }
  };

  await broadcastQuoteUpdate(env, { quoteCount: 1 });
  assert.equal(sentRequest.input, "https://quote-sync-room/broadcast");
  assert.equal(sentRequest.init.headers["X-Internal-Sync-Key"], SNAPSHOT_TOKEN);
  assert.deepEqual(JSON.parse(sentRequest.init.body), {
    type: "quotes_updated",
    quoteCount: 1
  });
});
