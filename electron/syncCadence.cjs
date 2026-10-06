// Background polling is only a safety net for missed realtime pushes. While the realtime
// connection is up, pollers run at their slow cadence; when it drops, they speed up (and run
// promptly) so changes still arrive. This keeps Cloudflare Worker requests low without making
// the app feel stale.

let realtimeConnected = false;
const listeners = new Set();

function setRealtimeConnected(value) {
  const next = Boolean(value);
  if (next === realtimeConnected) return;
  realtimeConnected = next;
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch (error) {
      console.error("[sync-cadence] Listener failed:", error.message);
    }
  }
}

function isRealtimeConnected() {
  return realtimeConnected;
}

function onRealtimeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CATCH_UP_MIN_GAP_MS = 30 * 1000;

function createAdaptivePoller({
  run,
  fastMs,
  slowMs,
  name = "poller",
  logger = console,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = Date.now
}) {
  if (typeof run !== "function") throw new Error("An adaptive poller needs a run function.");
  let timer = null;
  let running = false;
  let started = false;
  let lastRunAt = 0;
  let unsubscribe = null;

  const interval = () => (realtimeConnected ? slowMs : fastMs);

  const schedule = (delay) => {
    if (!started) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(tick, Math.max(0, delay));
    timer?.unref?.();
  };

  async function tick() {
    timer = null;
    if (!started) return;
    if (running) {
      schedule(interval());
      return;
    }
    running = true;
    lastRunAt = now();
    try {
      await run();
    } catch (error) {
      logger.warn(`[sync-cadence] ${name} failed:`, error?.message || error);
    } finally {
      running = false;
      schedule(interval());
    }
  }

  const handleRealtimeChange = (connected) => {
    if (!started || running) return;
    const sinceLast = now() - lastRunAt;
    if (!connected) {
      // Lost the push channel: fall back to the fast cadence right away.
      schedule(Math.max(0, fastMs - sinceLast));
      return;
    }
    // (Re)connected: anything missed while offline is fetched once, then the slow cadence.
    schedule(sinceLast >= CATCH_UP_MIN_GAP_MS ? 0 : slowMs - sinceLast);
  };

  return {
    start({ immediate = false } = {}) {
      if (started) return;
      started = true;
      unsubscribe = onRealtimeChange(handleRealtimeChange);
      schedule(immediate ? 0 : interval());
    },
    stop() {
      started = false;
      if (timer) clearTimeoutFn(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    // Runs now (unless a run is in flight) and restarts the cadence afterwards.
    runNow() {
      if (!started || running) return;
      schedule(0);
    },
    isStarted() {
      return started;
    }
  };
}

// For services that keep their own fixed interval timer: the tick stays cheap and local, and
// only reaches the network when realtime is down or the slow cadence has elapsed. Call ran()
// whenever the service syncs for any reason (push, manual, timer) so pushes reset the clock.
function createPollGate({ slowMs, now = Date.now }) {
  let lastRunAt = 0;
  return {
    due() {
      return !realtimeConnected || now() - lastRunAt >= slowMs;
    },
    ran() {
      lastRunAt = now();
    }
  };
}

module.exports = {
  createAdaptivePoller,
  createPollGate,
  setRealtimeConnected,
  isRealtimeConnected,
  onRealtimeChange
};
