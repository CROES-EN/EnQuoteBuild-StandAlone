const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createAdaptivePoller, createPollGate, setRealtimeConnected } = require("../../electron/syncCadence.cjs");
const { startRealtimeSync } = require("../../electron/realtimeSync.cjs");

function fakeClock() {
  let nowMs = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => nowMs,
    advance(ms) { nowMs += ms; },
    setTimeoutFn(fn, delay) { const id = nextId++; timers.set(id, { fn, delay }); return id; },
    clearTimeoutFn(id) { timers.delete(id); },
    pending() { return [...timers.values()]; },
    async fireNext() {
      const [id, timer] = [...timers.entries()][0];
      timers.delete(id);
      nowMs += timer.delay;
      await timer.fn();
    }
  };
}

test("adaptive poller runs slowly while realtime is connected and speeds up when it drops", async () => {
  setRealtimeConnected(false);
  const clock = fakeClock();
  let runs = 0;
  const poller = createAdaptivePoller({
    run: async () => { runs += 1; },
    fastMs: 90_000,
    slowMs: 600_000,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn.bind(clock),
    clearTimeoutFn: clock.clearTimeoutFn.bind(clock),
    logger: { warn() {} }
  });
  try {
    poller.start({ immediate: true });
    assert.equal(clock.pending()[0].delay, 0);
    await clock.fireNext();
    assert.equal(runs, 1);
    assert.equal(clock.pending()[0].delay, 90_000);

    setRealtimeConnected(true);
    assert.equal(clock.pending().length, 1);
    assert.equal(clock.pending()[0].delay, 600_000, "a fresh run is not repeated on connect");

    clock.advance(120_000);
    setRealtimeConnected(false);
    assert.equal(clock.pending()[0].delay, 0, "losing realtime runs the overdue fast poll at once");
    await clock.fireNext();
    assert.equal(runs, 2);

    clock.advance(45_000);
    setRealtimeConnected(true);
    assert.equal(clock.pending()[0].delay, 0, "reconnecting catches up on anything missed");
  } finally {
    poller.stop();
    setRealtimeConnected(false);
  }
  assert.equal(clock.pending().length, 0);
});

test("poll gate only lets fixed timers through on the slow cadence while connected", () => {
  let nowMs = 0;
  const gate = createPollGate({ slowMs: 600_000, now: () => nowMs });
  try {
    gate.ran();
    assert.equal(gate.due(), true, "disconnected: every tick is due");
    setRealtimeConnected(true);
    nowMs = 60_000;
    assert.equal(gate.due(), false);
    nowMs = 600_000;
    assert.equal(gate.due(), true);
  } finally {
    setRealtimeConnected(false);
  }
});

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static failNext = false;
  constructor() {
    super();
    if (FakeWebSocket.failNext) {
      FakeWebSocket.failNext = false;
      throw new Error("boom");
    }
    this.readyState = 1;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(message) { this.sent.push(message); }
  close() { this.readyState = FakeWebSocket.CLOSED; this.emit("close"); }
}

test("realtime reports connection changes and retries when the socket cannot be created", () => {
  FakeWebSocket.instances = [];
  FakeWebSocket.failNext = true;
  const states = [];
  const timeouts = [];
  const realtime = startRealtimeSync({
    workerUrl: "https://enquote-sync.example.workers.dev",
    sharedSecret: "token",
    WebSocketImpl: FakeWebSocket,
    onConnectionChange: (value) => states.push(value),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (fn) => { timeouts.push(fn); return 2; },
    clearTimeoutFn: () => {},
    logger: { info() {}, warn() {}, error() {} }
  });
  assert.equal(timeouts.length, 1, "a failed connect schedules a retry instead of throwing");
  timeouts.shift()();
  const socket = FakeWebSocket.instances[0];
  socket.emit("open");
  assert.equal(realtime.isConnected(), true);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "pong" })));
  socket.close();
  assert.deepEqual(states, [true, false]);
  assert.equal(timeouts.length, 1);
  realtime.stop();
  assert.deepEqual(states, [true, false]);
});
