// Outbound sync: EnQuote -> Base44, now routed through the Cloudflare Worker.

const https = require("node:https");
const http = require("node:http");
const {notificationEventId} = require("./notificationEvents.cjs");

const DEFAULT_INTERVAL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const CONFLICT_PREFIX = "CONFLICT:";

function requestJson(urlString, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(urlString); } catch { resolve({ ok: false, error: `Invalid URL: ${urlString}` }); return; }
    const transport = url.protocol === "http:" ? http : https;
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
      path: `${url.pathname}${url.search}`, method,
      headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}), ...headers }
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok, status: res.statusCode, body: parsed, raw, error: ok ? null : `HTTP ${res.statusCode}` });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); resolve({ ok: false, error: "Request timed out" }); });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const LOCAL_ONLY_FIELDS = new Set(["id", "base44_id", "base44_synced_at"]);

function toRemotePayload(quote) {
  const payload = {};
  for (const [key, value] of Object.entries(quote)) {
    if (LOCAL_ONLY_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    payload[key] = value;
  }
  payload.local_quote_id = quote.id;
  return payload;
}

function createOutboundSync({ repository, config, logger = console, onAfterWrite }) {
  const { workerUrl, outboundToken, intervalMs = DEFAULT_INTERVAL_MS } = config || {};
  let running = false;
  const awaitingRemoteStatus = new Map();
  let timer = null;
  const isConfigured = Boolean(workerUrl && outboundToken);
  const enqueueUrl = () => `${String(workerUrl).replace(/\/+$/, "")}/api/outbound/enqueue`;
  const inboundUrl = () => `${String(workerUrl).replace(/\/+$/, "")}/api/inbound/base44`;
  const authHeaders = () => ({
    Authorization: `Bearer ${outboundToken}`,
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || "",
  });

  function buildQuoteMessage(entry) {
    return { entityType: "quote", action: entry.kind, localId: entry.local_id, quote: toRemotePayload(entry.quote),
      quoteId: entry.local_id, remoteId: entry.remote_id || null, base44SyncedAt: entry.quote?.base44_synced_at || null, quoteNumber: entry.quote_number || null };
  }
  function buildQuoteDeleteMessage(entry) {
    return {
      entityType: "quote",
      action: "delete",
      localId: entry.local_id,
      remoteId: entry.remote_id || null,
      quoteNumber: entry.quote_number || null
    };
  }
  function buildDismissalMessage(entry) { return { entityType: "dismissal", localId: entry.local_id, quoteId: entry.quote_id }; }
  function buildMentionMessage(entry, localRecord) {
    return { entityType: "mention", localId: entry.local_id, quoteId: entry.quote_id, siteId: localRecord?.site_id || "",
      mentionedEmail: entry.mentioned_email, mentionedBy: localRecord?.mentioned_by || "", message: localRecord?.message || "", priority: localRecord?.priority || "yellow" };
  }

  async function sendOne(message, url = enqueueUrl()) {
    const response = await requestJson(url, { method: "POST", headers: authHeaders(), body: message });
    if (!response.ok) return { local_id: message.localId, error: response.error || `HTTP ${response.status}` };
    const result = response.body;
    if (!result.ok) {
      if (result.queued && result.itemId) {
        return { local_id: message.localId, queued: true, item_id: String(result.itemId) };
      }
      if (result.status === "conflict") return { local_id: message.localId, error: `${CONFLICT_PREFIX} Base44's copy was updated at ${result.conflict_with}, which is more recent than this app's last known sync. Skipped to avoid overwriting.` };
      return { local_id: message.localId, error: result.error || "Unknown error from Worker" };
    }
    if (result.status === "conflict") {
      return { local_id: message.localId, error: `${CONFLICT_PREFIX} Base44's copy was updated at ${result.conflict_with || "an unknown time"}, which is more recent than this app's last known sync. Skipped to avoid overwriting.` };
    }
    return { local_id: message.localId, remote_id: result.remote_id || null };
  }

  async function handleRealtimeStatus(data) {
    if (data?.entityType !== "quote" || typeof data.quoteId !== "string" || !data.quoteId) return { updated: 0 };
    const result = { local_id: data.quoteId };
    if (data.status === "pushed" || data.status === "adopted") {
      result.remote_id = data.remoteId || null;
    } else if (data.status === "conflict") {
      result.error = `${CONFLICT_PREFIX} Base44's copy was updated at ${data.conflictWith || "an unknown time"}, which is more recent than this app's last known sync. Skipped to avoid overwriting.`;
    } else if (data.status === "error") {
      result.error = data.errorMessage || "The Worker could not sync this quote.";
    } else {
      return { updated: 0 };
    }

    const update = await repository.markOutboundSynced([result]);
    if (data.itemId && awaitingRemoteStatus.get(data.quoteId) === data.itemId) {
      awaitingRemoteStatus.delete(data.quoteId);
    }
    if (update.updated) onAfterWrite?.();
    return update;
  }

  async function flush() {
    if (running) return { skipped: "already-running" };
    if (!isConfigured) return { skipped: "not-configured" };
    running = true;
    try {
      const pending = await repository.listPendingOutboundQuotes();
      const eligible = pending.filter((entry) => !awaitingRemoteStatus.has(entry.local_id));
      const results = [];
      for (const entry of eligible) {
        try {
          const message = buildQuoteMessage(entry);
          // /api/outbound/enqueue only stores to D1 and never calls Base44, so quote
          // creates/edits must go through /api/inbound/base44 to actually reach Base44.
          const result = await sendOne(message, inboundUrl());
          if (result.queued) {
            awaitingRemoteStatus.set(entry.local_id, result.item_id);
            continue;
          }
          results.push(result);
          if (!result.error && entry.quote_number && repository?.createCollectionRecord) {
            const eventId = notificationEventId("quote_synced", {
              ...entry.quote, id: entry.local_id, base44_id: entry.local_id
            });
            try {
              const existing = await repository.listCollection("appNotifications");
              if (!existing.some(item => item.eventId === eventId)) {
                await repository.createCollectionRecord("appNotifications", {
                  eventId, type: "quote_synced", quoteId: entry.local_id,
                  quoteNumber: entry.quote_number,
                  occurredAt: entry.quote.updated_date || new Date().toISOString(), read: false
                });
              }
            } catch (error) {
              logger.warn(`[outbound-sync] Could not save notification for ${entry.local_id}: ${error.message}`);
            }
          }
        } catch (error) { results.push({ local_id: entry.local_id, error: error.message }); }
      }
      if (results.length) await repository.markOutboundSynced(results);

      const pendingQuoteDeletes = await repository.listPendingOutboundQuoteDeletes();
      let quoteDeleteResults = [];
      if (pendingQuoteDeletes.length) {
        quoteDeleteResults = [];
        for (const entry of pendingQuoteDeletes) {
          try {
            const message = buildQuoteDeleteMessage(entry);
            quoteDeleteResults.push(await sendOne(message, inboundUrl()));
          } catch (error) {
            quoteDeleteResults.push({ local_id: entry.local_id, error: error.message });
          }
        }
        await repository.markOutboundQuoteDeletesSynced(quoteDeleteResults);
        const deleteFailures = quoteDeleteResults.filter(result => result.error);
        if (deleteFailures.length) {
          logger.warn(`[outbound-sync] ${deleteFailures.length} quote deletion(s) failed; they remain queued.`, deleteFailures);
        }
      }

      const pendingDismissals = await repository.listPendingOutboundDismissals();
      if (pendingDismissals.length) {
        const dismissalResults = [];
        for (const entry of pendingDismissals) {
          try { const message = buildDismissalMessage(entry); const result = await sendOne(message); dismissalResults.push(result); }
          catch (error) { dismissalResults.push({ local_id: entry.local_id, error: error.message }); }
        }
        await repository.markOutboundDismissalsSynced(dismissalResults);
        const dismissalFailed = dismissalResults.filter((r) => r.error);
        if (dismissalFailed.length) logger.warn(`[outbound-sync] ${dismissalFailed.length} dismissal(s) failed; they remain queued.`, dismissalFailed);
      }

      const pendingMentions = await repository.listPendingOutboundMentions();
      if (pendingMentions.length) {
        const localQuoteAlerts = await repository.listCollection("quoteAlerts");
        const mentionResults = [];
        for (const entry of pendingMentions) {
          try { const localRecord = (localQuoteAlerts || []).find((item) => item.id === entry.local_id); const message = buildMentionMessage(entry, localRecord); const result = await sendOne(message); mentionResults.push(result); }
          catch (error) { mentionResults.push({ local_id: entry.local_id, error: error.message }); }
        }
        await repository.markOutboundMentionsSynced(mentionResults);
        const mentionFailed = mentionResults.filter((r) => r.error);
        if (mentionFailed.length) logger.warn(`[outbound-sync] ${mentionFailed.length} mention(s) failed; they remain queued.`, mentionFailed);
      }

      onAfterWrite?.();
      const failed = results.filter((r) => r.error);
      const conflicts = failed.filter((r) => r.error.startsWith(CONFLICT_PREFIX));
      const otherFailed = failed.length - conflicts.length;
      const deleteFailures = quoteDeleteResults.filter((result) => result.error).length;
      if (conflicts.length) logger.warn(`[outbound-sync] ${conflicts.length} quote(s) held back due to CONFLICT; they remain queued and will be re-checked.`);
      if (otherFailed) {
logger.warn(`[outbound-sync] ${otherFailed} quote(s) failed to sync; they remain queued.`);
failed.filter((r) => !r.error.startsWith(CONFLICT_PREFIX)).forEach((r) => {
logger.warn(`[outbound-sync] -> local_id=${r.local_id}: ${r.error}`);
});
}
      return {
        pushed: results.length - failed.length + quoteDeleteResults.length - deleteFailures,
        failed: failed.length + deleteFailures,
        conflicts: conflicts.length
      };
    } catch (error) { logger.warn("[outbound-sync] Flush failed:", error.message); return { error: error.message }; }
    finally { running = false; }
  }

  return {
    isConfigured, flush, handleRealtimeStatus,
    start() {
      if (!isConfigured) { logger.log("[outbound-sync] Disabled: workerUrl / outboundToken not configured. Quotes stay queued locally."); return; }
      if (timer) return;
      flush();
      timer = setInterval(flush, intervalMs);
      if (timer.unref) timer.unref();
      logger.log(`[outbound-sync] Enabled; flushing every ${Math.round(intervalMs / 1000)}s via Worker.`);
    },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}

module.exports = { createOutboundSync };
