// Pushes locally-created quotes, and edits to quotes that already exist in
// Base44, up to Base44. Each queue entry has a `kind` of "create" or "update"
// (set by repository.cjs) and is applied at most once.
//
// Design goals (in priority order):
//   1. NEVER create a duplicate quote in Base44.
//   2. Never block or break the app when Base44 is unreachable - the app is
//      offline-first, so a failed push must simply leave the quote queued.
//
// Duplicate protection is layered:
//   - The repository's queue is keyed on `local_id` per kind, so one edit
//     yields at most one pending entry.
//   - A single in-flight guard (`running`) prevents two overlapping flushes
//     from sending the same pending entry twice.
//   - Before creating anything, we ask Base44 whether a quote with the same
//     `quote_number` already exists and, if so, we adopt that remote id and
//     mark the entry synced instead of creating a second copy. Updates never
//     need this check since their `remote_id` is already known.
//   - Only a confirmed success acks the entry; failures increment `attempts`
//     and leave it pending for the next flush.

const https = require("node:https");
const http = require("node:http");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 20000;

function requestJson(urlString, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      resolve({ ok: false, error: `Invalid URL: ${urlString}` });
      return;
    }

    const transport = url.protocol === "http:" ? http : https;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, status: res.statusCode, body: parsed, raw, error: ok ? null : `HTTP ${res.statusCode}` });
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ ok: false, error: "Request timed out" });
    });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// Fields that are local bookkeeping and must not be sent to Base44.
const LOCAL_ONLY_FIELDS = new Set(["id", "base44_id", "base44_synced_at"]);

function toRemotePayload(quote) {
  const payload = {};
  for (const [key, value] of Object.entries(quote)) {
    if (LOCAL_ONLY_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    payload[key] = value;
  }
  // Carry the local id so Base44 (and a human auditing the data) can always
  // trace a remote record back to the desktop quote that produced it.
  payload.local_quote_id = quote.id;
  return payload;
}

function createOutboundSync({ repository, config, logger = console, onAfterWrite }) {
  const { serverUrl, appId, apiKey, intervalMs = DEFAULT_INTERVAL_MS } = config || {};
  let running = false;
  let timer = null;

  const isConfigured = Boolean(serverUrl && appId && apiKey);
  const entityUrl = () => `${String(serverUrl).replace(/\/+$/, "")}/api/apps/${appId}/entities/Quote`;
  // Matches the header shape the official @base44/sdk client sends for
  // API-key auth (X-App-Id + api_key, no Authorization/token header).
  const authHeaders = () => ({ "X-App-Id": String(appId), api_key: apiKey });

  // Returns the remote id if Base44 already holds this quote, else null.
  async function findExisting(quote) {
    const identifiers = [];
    if (quote.quote_number) identifiers.push({ quote_number: quote.quote_number });
    identifiers.push({ local_quote_id: quote.id });

    for (const filter of identifiers) {
      const url = `${entityUrl()}?q=${encodeURIComponent(JSON.stringify(filter))}&limit=1`;
      const response = await requestJson(url, { headers: authHeaders() });
      if (!response.ok) continue;
      const rows = Array.isArray(response.body) ? response.body : response.body?.items;
      if (Array.isArray(rows) && rows.length > 0 && rows[0]?.id) {
        return String(rows[0].id);
      }
    }
    return null;
  }

  // Pushes an edit to a quote that already exists in Base44 (entry.remote_id is known,
  // set when the edit was queued - see enqueueOutboundUpdate in repository.cjs). Mirrors
  // the official @base44/sdk client's entities.update(), which does a PUT to
  // `${entityUrl}/${id}` rather than posting a new record.
  async function pushUpdate(entry) {
    const response = await requestJson(`${entityUrl()}/${entry.remote_id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: toRemotePayload(entry.quote)
    });

    if (!response.ok) {
      return { local_id: entry.local_id, error: response.error || "Unknown error" };
    }
    logger.log(`[outbound-sync] Pushed update for ${entry.local_id} -> Base44 ${entry.remote_id}`);
    return { local_id: entry.local_id, remote_id: entry.remote_id };
  }

  async function pushCreate(entry) {
    const existingId = await findExisting(entry.quote);
    if (existingId) {
      logger.log(`[outbound-sync] ${entry.local_id} already exists in Base44 as ${existingId}; adopting instead of creating.`);
      return { local_id: entry.local_id, remote_id: existingId };
    }

    const response = await requestJson(entityUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: toRemotePayload(entry.quote)
    });

    if (!response.ok) {
      return { local_id: entry.local_id, error: response.error || "Unknown error" };
    }
    const remoteId = response.body?.id ? String(response.body.id) : null;
    logger.log(`[outbound-sync] Pushed ${entry.local_id} -> Base44 ${remoteId || "(no id returned)"}`);
    return { local_id: entry.local_id, remote_id: remoteId };
  }

  function pushOne(entry) {
    return entry.kind === "update" ? pushUpdate(entry) : pushCreate(entry);
  }

  async function flush() {
    if (running) return { skipped: "already-running" };
    if (!isConfigured) return { skipped: "not-configured" };

    running = true;
    try {
      const pending = await repository.listPendingOutboundQuotes();
      const eligible = pending.filter((entry) => (entry.attempts || 0) < MAX_ATTEMPTS);
      if (!eligible.length) return { pushed: 0, failed: 0 };

      const results = [];
      for (const entry of eligible) {
        try {
          results.push(await pushOne(entry));
        } catch (error) {
          results.push({ local_id: entry.local_id, error: error.message });
        }
      }

      await repository.markOutboundSynced(results);
      onAfterWrite?.();
      const failed = results.filter((result) => result.error);
      if (failed.length) {
        logger.warn(`[outbound-sync] ${failed.length} quote(s) failed to sync; they remain queued.`, failed);
      }
      return { pushed: results.length - failed.length, failed: failed.length };
    } catch (error) {
      logger.warn("[outbound-sync] Flush failed:", error.message);
      return { error: error.message };
    } finally {
      running = false;
    }
  }

  return {
    isConfigured,
    flush,
    start() {
      if (!isConfigured) {
        logger.log("[outbound-sync] Disabled: BASE44_API_KEY / app id not configured. Quotes stay queued locally.");
        return;
      }
      if (timer) return;
      flush();
      timer = setInterval(flush, intervalMs);
      if (timer.unref) timer.unref();
      logger.log(`[outbound-sync] Enabled; flushing every ${Math.round(intervalMs / 1000)}s.`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { createOutboundSync };
