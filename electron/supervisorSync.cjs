const fs = require("node:fs");

const COLLECTIONS = ["supervisorDailyMetrics", "supervisorReportTables"];
const DEFAULT_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EPOCH_STAMP = "1970-01-01T00:00:00.000Z";
// Must match MAX_RECORD_CHARS in the Worker (enquote-sync-worker/src/supervisor.js).
const MAX_SYNC_RECORD_CHARS = 8_000_000;

const keyOf = (collection, id) => `${collection}/${id}`;

function stampOf(record) {
  for (const candidate of [record?.updated_date, record?.created_date]) {
    if (typeof candidate === "string" && STAMP_PATTERN.test(candidate)) return candidate;
  }
  return EPOCH_STAMP;
}

/**
 * Keeps the Supervisor Dashboard's imported data (daily metrics + report tables) identical on
 * every machine by mirroring those two local collections to the Cloudflare Worker. Newest
 * record stamp wins per record; deletions are tombstoned on the Worker. Local reads/writes
 * are untouched - this only reconciles in the background and reports back when remote
 * changes were applied locally.
 */
function createSupervisorSync({
  workerUrl,
  repository,
  pendingDeletesPath,
  getIdentity,
  getOutboundToken,
  getAccessHeaders = () => ({}),
  onRemoteApplied = () => {},
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  let timer = null;
  let running = null;
  let rerunRequested = false;
  const oversizeWarned = new Set();

  function readPendingDeletes() {
    try {
      const parsed = JSON.parse(fs.readFileSync(pendingDeletesPath, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePendingDeletes(pending) {
    try {
      fs.writeFileSync(pendingDeletesPath, JSON.stringify(pending), "utf8");
    } catch (error) {
      logger.warn("[supervisor-sync] Could not persist pending deletions:", error.message);
    }
  }

  function identityEmail() {
    const email = getIdentity()?.email;
    return typeof email === "string" ? email.trim().toLowerCase() : "";
  }

  async function request(method, route, body) {
    const token = getOutboundToken();
    if (!token) throw new Error("Cloudflare sync credentials are unavailable.");
    const response = await fetchImpl(new URL(route, workerUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...getAccessHeaders()
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Handled below as an invalid response.
    }
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error || `Supervisor sync responded with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function pushRecord(collection, record) {
    const email = identityEmail();
    if (!email) throw new Error("Verified Cloudflare identity is unavailable.");
    // The Worker rejects records over its size cap, so don't re-upload a multi-megabyte table
    // every cycle just to be refused. It stays local-only; warn once per version of the record.
    if (JSON.stringify(record).length > MAX_SYNC_RECORD_CHARS) {
      const marker = `${keyOf(collection, record.id)}@${stampOf(record)}`;
      if (!oversizeWarned.has(marker)) {
        oversizeWarned.add(marker);
        logger.warn(`[supervisor-sync] ${keyOf(collection, record.id)} is too large to share (over ${MAX_SYNC_RECORD_CHARS} characters); keeping it local-only.`);
      }
      return { ok: true, skipped: true };
    }
    return request("POST", "/api/supervisor/upsert", {
      email, collection, id: record.id, updatedAt: stampOf(record), record
    });
  }

  async function pushDelete(collection, id, deletedAt) {
    const email = identityEmail();
    if (!email) throw new Error("Verified Cloudflare identity is unavailable.");
    return request("POST", "/api/supervisor/delete", { email, collection, id, deletedAt });
  }

  async function flushPendingDeletes() {
    const pending = readPendingDeletes();
    let changed = false;
    for (const [key, deletedAt] of Object.entries(pending)) {
      const separator = key.indexOf("/");
      try {
        await pushDelete(key.slice(0, separator), key.slice(separator + 1), deletedAt);
        delete pending[key];
        changed = true;
      } catch (error) {
        logger.warn(`[supervisor-sync] Could not push deletion of ${key} yet:`, error.message);
      }
    }
    if (changed) writePendingDeletes(pending);
    return pending;
  }

  async function pull(collection, id) {
    // A deletion made moments ago must not be undone by a download that was already planned.
    if (readPendingDeletes()[keyOf(collection, id)]) return false;
    const query = new URLSearchParams({ collection, id });
    const remote = await request("GET", `/api/supervisor/record?${query}`);
    const result = await repository.applyRemoteCollectionRecord(
      collection, id, remote.deleted ? null : remote.record, remote.updatedAt
    );
    return result.applied;
  }

  async function runReconcile() {
    const pending = await flushPendingDeletes();
    const { records: remoteRecords } = await request("GET", "/api/supervisor/index");
    const remoteByKey = new Map(remoteRecords.map((entry) => [keyOf(entry.collection, entry.id), entry]));

    let appliedLocally = 0;
    const seen = new Set();
    for (const collection of COLLECTIONS) {
      const localRecords = (await repository.listCollection(collection)) || [];
      for (const local of localRecords) {
        const key = keyOf(collection, local.id);
        seen.add(key);
        if (pending[key]) continue;
        const remote = remoteByKey.get(key);
        const localStamp = stampOf(local);
        try {
          if (!remote) {
            await pushRecord(collection, local);
          } else if (remote.deleted) {
            if (localStamp > remote.updatedAt) await pushRecord(collection, local);
            else if (await pull(collection, local.id)) appliedLocally += 1;
          } else if (remote.updatedAt > localStamp) {
            if (await pull(collection, local.id)) appliedLocally += 1;
          } else if (localStamp > remote.updatedAt) {
            await pushRecord(collection, local);
          }
        } catch (error) {
          logger.warn(`[supervisor-sync] Could not sync ${key}:`, error.message);
        }
      }
    }

    for (const [key, remote] of remoteByKey) {
      if (seen.has(key) || remote.deleted || pending[key]) continue;
      try {
        if (await pull(remote.collection, remote.id)) appliedLocally += 1;
      } catch (error) {
        logger.warn(`[supervisor-sync] Could not download ${key}:`, error.message);
      }
    }

    if (appliedLocally > 0) {
      logger.info(`[supervisor-sync] Applied ${appliedLocally} shared change(s) from Cloudflare.`);
      onRemoteApplied({ appliedLocally });
    }
    return { ok: true, appliedLocally };
  }

  // Calls arriving while a reconcile is in flight are coalesced into exactly one follow-up
  // run, so a burst of realtime notifications never stacks up concurrent syncs.
  function reconcile() {
    if (running) {
      rerunRequested = true;
      return running;
    }
    running = (async () => {
      try {
        return await runReconcile();
      } catch (error) {
        logger.warn("[supervisor-sync] Reconcile failed:", error.message);
        return { ok: false, error: error.message };
      } finally {
        running = null;
        if (rerunRequested) {
          rerunRequested = false;
          void reconcile();
        }
      }
    })();
    return running;
  }

  // Best-effort immediate push after a local save. A failure is fine: the record's newer
  // stamp is picked up by the next reconcile.
  async function recordSaved(collection, record) {
    if (!COLLECTIONS.includes(collection) || !record?.id) return;
    try {
      await pushRecord(collection, record);
    } catch (error) {
      logger.warn(`[supervisor-sync] Could not push ${keyOf(collection, record.id)} yet:`, error.message);
    }
  }

  // Deletions have no record left to compare later, so they're persisted until the Worker
  // acknowledges them - otherwise a restart could let the still-shared copy come back.
  async function recordDeleted(collection, id) {
    if (!COLLECTIONS.includes(collection) || !id) return;
    const deletedAt = new Date().toISOString();
    const pending = readPendingDeletes();
    pending[keyOf(collection, id)] = deletedAt;
    writePendingDeletes(pending);
    try {
      await pushDelete(collection, id, deletedAt);
      const latest = readPendingDeletes();
      if (latest[keyOf(collection, id)] === deletedAt) {
        delete latest[keyOf(collection, id)];
        writePendingDeletes(latest);
      }
    } catch (error) {
      logger.warn(`[supervisor-sync] Could not push deletion of ${keyOf(collection, id)} yet:`, error.message);
    }
  }

  function start() {
    if (timer) return;
    void reconcile();
    timer = setIntervalFn(() => { void reconcile(); }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, reconcile, recordSaved, recordDeleted };
}

module.exports = { createSupervisorSync, COLLECTIONS };
