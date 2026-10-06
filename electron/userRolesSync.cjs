// Keeps this install's local "users" list (emails, names, roles) in step with Base44 through the
// Cloudflare Worker's /api/users. Without it a fresh install has no user records at all, so the
// app treated everyone as "submitter" and hid role-gated tabs such as the Supervisor Dashboard.
//
// Merge rules: a Base44 user replaces the local record with the same email (Base44 is the source
// of truth for roles). Records that came from Base44 earlier but are no longer in the list are
// removed (that person lost access). Records that never came from Base44 - for example one added
// locally with Grant-EnQuoteRole.ps1 - are left alone.

const { createPollGate } = require("./syncCadence.cjs");

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
// While realtime pushes are flowing, the timer only reaches the Worker on the slow cadence.
const CONNECTED_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const SOURCE = "base44-sync";

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

function mergeUsers(local, remoteUsers) {
  const remoteByEmail = new Map();
  for (const user of remoteUsers) {
    const email = normalizeEmail(user?.email);
    if (email) remoteByEmail.set(email, user);
  }

  let changed = false;
  const next = [];
  const seen = new Set();

  for (const record of local) {
    const email = normalizeEmail(record?.email);
    const remote = remoteByEmail.get(email);
    if (remote) {
      if (seen.has(email)) { changed = true; continue; }
      seen.add(email);
      const merged = { ...record, ...remote, id: record.id && !String(record.id).startsWith("local-role-") ? record.id : (remote.id || record.id), email, source: SOURCE };
      if (JSON.stringify(merged) !== JSON.stringify(record)) changed = true;
      next.push(merged);
    } else if (record?.source === SOURCE) {
      changed = true;
    } else {
      next.push(record);
    }
  }

  for (const [email, remote] of remoteByEmail) {
    if (seen.has(email)) continue;
    next.push({ ...remote, email, source: SOURCE });
    changed = true;
  }

  return changed ? next : null;
}

function createUserRolesSync({
  repository,
  workerUrl,
  getOutboundToken,
  getAccessHeaders = () => ({}),
  onChanged = () => {},
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  let timer = null;
  const pollGate = createPollGate({ slowMs: CONNECTED_INTERVAL_MS });
  let inFlight = null;

  async function fetchUsers() {
    const token = getOutboundToken();
    if (!token) throw new Error("Cloudflare sync credentials are unavailable.");
    const response = await fetchImpl(new URL("/api/users", workerUrl), {
      headers: { Authorization: `Bearer ${token}`, ...getAccessHeaders() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    let body = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !body?.ok || !Array.isArray(body.users)) {
      throw new Error(body?.error || `User sync responded with HTTP ${response.status}.`);
    }
    return body.users;
  }

  function sync() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const users = await fetchUsers();
        // An empty list would wipe every synced user; treat it as a failed fetch instead.
        if (users.length === 0) return { ok: false, error: "Received an empty user list." };
        const result = await repository.mutateCollection("users", (local) => mergeUsers(local, users));
        if (result.changed) onChanged();
        return { ok: true, changed: result.changed, count: users.length };
      } catch (error) {
        logger.warn("[user-sync] Could not sync users (existing roles are unchanged):", error.message);
        return { ok: false, error: error.message };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function start({ immediate = true } = {}) {
    if (timer) return;
    pollGate.ran();
    if (immediate) void sync();
    timer = setIntervalFn(() => {
      if (!pollGate.due()) return;
      pollGate.ran();
      void sync();
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { sync, start, stop };
}

module.exports = { createUserRolesSync, mergeUsers, SOURCE };
