const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { makeWebSocketUrl, startRealtimeSync } = require("../../electron/realtimeSync.cjs");

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(message) {
    this.sent.push(message);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

test("builds the Worker WebSocket URL", () => {
  assert.equal(
    makeWebSocketUrl("https://enquote-sync.example.workers.dev/path?ignored=1"),
    "wss://enquote-sync.example.workers.dev/ws"
  );
});

test("authenticates, keeps the connection alive, and handles both update types", () => {
  FakeWebSocket.instances = [];
  let pingCallback;
  let clearedPings = 0;
  let received;
  let outboundStatus;
  const realtime = startRealtimeSync({
    workerUrl: "https://enquote-sync.example.workers.dev",
    sharedSecret: "test-snapshot-token",
    accessHeaders: {
      "CF-Access-Client-Id": "access-id",
      "CF-Access-Client-Secret": "access-secret"
    },
    onQuotesUpdated: (data) => { received = data; },
    onOutboundStatus: (data) => { outboundStatus = data; },
    WebSocketImpl: FakeWebSocket,
    setIntervalFn: (callback) => {
      pingCallback = callback;
      return 42;
    },
    clearIntervalFn: () => { clearedPings += 1; },
    setTimeoutFn: () => 99,
    clearTimeoutFn: () => {}
  });

  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "wss://enquote-sync.example.workers.dev/ws");
  assert.equal(socket.options.headers["X-ENQuote-Shared-Secret"], "test-snapshot-token");
  assert.equal(socket.options.headers["CF-Access-Client-Id"], "access-id");
  assert.equal(socket.options.headers["CF-Access-Client-Secret"], "access-secret");

  socket.readyState = FakeWebSocket.OPEN;
  socket.emit("open");
  pingCallback();
  assert.deepEqual(socket.sent, [JSON.stringify({ type: "ping" })]);

  socket.emit("message", Buffer.from(JSON.stringify({ type: "quotes_updated", quoteCount: 2 })));
  assert.deepEqual(received, { type: "quotes_updated", quoteCount: 2 });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "outbound_status", itemId: "worker-item", status: "pushed" })));
  assert.deepEqual(outboundStatus, { type: "outbound_status", itemId: "worker-item", status: "pushed" });

  realtime.stop();
  assert.equal(clearedPings, 1);
  assert.equal(socket.readyState, FakeWebSocket.CLOSED);
});

test("reconnects after a closed socket and stops scheduled reconnects", () => {
  FakeWebSocket.instances = [];
  let reconnect;
  let cancelled = false;
  const realtime = startRealtimeSync({
    workerUrl: "https://enquote-sync.example.workers.dev",
    sharedSecret: "test-snapshot-token",
    WebSocketImpl: FakeWebSocket,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (callback) => {
      reconnect = callback;
      return 7;
    },
    clearTimeoutFn: () => { cancelled = true; }
  });

  FakeWebSocket.instances[0].emit("close");
  reconnect();
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[1].emit("close");
  realtime.stop();
  assert.equal(cancelled, true);
});

test("requires the Worker URL and snapshot token", () => {
  assert.throws(() => startRealtimeSync({ workerUrl: "https://example.workers.dev" }), /snapshot token/);
});
