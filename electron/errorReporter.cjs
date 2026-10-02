const crypto = require("node:crypto");

// Sends errors from the app (UI errors forwarded by the window, plus crashes in the main
// process) to the Worker so they can be reviewed without waiting for someone to report them.
//
// Built to never make things worse: identical errors are folded into one entry with a count,
// reports are rate-limited, the queue is capped, nothing is sent until sign-in provides
// credentials, and a failed send just retries later. Reporting problems are never reported.

const FLUSH_INTERVAL_MS = 60 * 1000;
const MAX_QUEUE = 100;
const MAX_NEW_FINGERPRINTS_PER_HOUR = 40;
const REQUEST_TIMEOUT_MS = 20 * 1000;

function fingerprintOf({ source, message, stack }) {
  // Message plus the first stack frame: stable across reloads, distinct across real bugs.
  const firstFrame = String(stack || "").split("\n").find((line) => /\bat\b|@/.test(line)) || "";
  const normalized = `${source}|${String(message || "").replace(/\d+/g, "#").slice(0, 300)}|${firstFrame.replace(/[:?]\d+(:\d+)?\)?$/, "").trim().slice(0, 200)}`;
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 20);
}

function createErrorReporter({
  workerUrl,
  getIdentity,
  getToken,
  getAccessHeaders = () => ({}),
  getVersions = () => ({ appVersion: "", uiVersion: "" }),
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  const queue = new Map(); // fingerprint -> entry
  let timer = null;
  let flushing = null;
  let hourStart = now();
  let newThisHour = 0;

  function report({ source, message, stack, page } = {}) {
    if (!message && !stack) return false;
    const fingerprint = fingerprintOf({ source, message, stack });
    const existing = queue.get(fingerprint);
    if (existing) {
      existing.count += 1;
      return true;
    }
    if (now() - hourStart > 60 * 60 * 1000) {
      hourStart = now();
      newThisHour = 0;
    }
    if (newThisHour >= MAX_NEW_FINGERPRINTS_PER_HOUR || queue.size >= MAX_QUEUE) return false;
    newThisHour += 1;
    queue.set(fingerprint, {
      fingerprint,
      source: String(source || "unknown"),
      message: String(message || "").slice(0, 1000),
      stack: String(stack || "").slice(0, 4000),
      page: String(page || "").slice(0, 200),
      count: 1
    });
    return true;
  }

  async function sendBatch() {
    if (queue.size === 0) return { sent: 0 };
    const email = String(getIdentity()?.email || "").trim().toLowerCase();
    const token = getToken();
    if (!email || !token) return { sent: 0, reason: "no-credentials" };

    const batch = [...queue.values()].slice(0, 20);
    const response = await fetchImpl(new URL("/api/errors", workerUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...getAccessHeaders() },
      body: JSON.stringify({ email, ...getVersions(), errors: batch }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Error report upload responded with HTTP ${response.status}.`);
    for (const entry of batch) queue.delete(entry.fingerprint);
    return { sent: batch.length };
  }

  function flush() {
    if (flushing) return flushing;
    flushing = sendBatch()
      .catch((error) => {
        logger.warn("[error-report] Could not send (will retry):", error.message);
        return { sent: 0, error: error.message };
      })
      .finally(() => { flushing = null; });
    return flushing;
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => { void flush(); }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { report, flush, start, stop, pendingCount: () => queue.size };
}

module.exports = { createErrorReporter, fingerprintOf };
