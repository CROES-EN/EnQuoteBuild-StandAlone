// Outbound sync: EnQuote -> Base44, now routed through the Cloudflare Worker.

const https = require("node:https");
const http = require("node:http");

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
  let timer = null;
  const isConfigured = Boolean(workerUrl && outboundToken);
  const enqueueUrl = () => `${String(workerUrl).replace(/\/+$/, "")}/api/outbound/enqueue`;
  const authHeaders = () => ({ Authorization: `Bearer ${outboundToken}` });

  function buildQuoteMessage(entry) {
    return { entityType: "quote", action: entry.kind, localId: entry.local_id, quote: toRemotePayload(entry.quote),
      quoteId: entry.local_id, remoteId: entry.remote_id || null, base44SyncedAt: entry.quote?.base44_synced_at || null, quoteNumber: entry.quote_number || null };
  }
  function buildDismissalMessage(entry) { return { entityType: "dismissal", localId: entry.local_id, quoteId: entry.quote_id }; }
  function buildMentionMessage(entry, localRecord) {
    return { entityType: "mention", localId: entry.local_id, quoteId: entry.quote_id, siteId: localRecord?.site_id || "",
      mentionedEmail: entry.mentioned_email, mentionedBy: localRecord?.mentioned_by || "", message: localRecord?.message || "", priority: localRecord?.priority || "yellow" };
  }

  async function sendOne(message) {
    const response = await requestJson(enqueueUrl(), { method: "POST", headers: authHeaders(), body: message });
    if (!response.ok) return { local_id: message.localId, error: response.error || `HTTP ${response.status}` };
    const result = response.body;
    if (!result.ok) {
      if (result.status === "conflict") return { local_id: message.localId, error: `${CONFLICT_PREFIX} Base44's copy was updated at ${result.conflict_with}, which is more recent than this app's last known sync. Skipped to avoid overwriting.` };
      return { local_id: message.localId, error: result.error || "Unknown error from Worker" };
    }
    return { local_id: message.localId, remote_id: result.remote_id || null };
  }

  async function flush() {
    if (running) return { skipped: "already-running" };
    if (!isConfigured) return { skipped: "not-configured" };
    running = true;
    try {
      const pending = await repository.listPendingOutboundQuotes();
      const eligible = pending;
      const results = [];
      for (const entry of eligible) {
        try {
          const message = buildQuoteMessage(entry);
          const result = await sendOne(message);
          results.push(result);
          if (!result.error && entry.quote_number && repository?.createCollectionRecord) {
            repository.createCollectionRecord("appNotifications", { type: "quote_synced", quoteId: entry.local_id, quoteNumber: entry.quote_number, occurredAt: new Date().toISOString(), read: false }).catch(() => {});
          }
        } catch (error) { results.push({ local_id: entry.local_id, error: error.message }); }
      }
      if (results.length) await repository.markOutboundSynced(results);

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
      if (conflicts.length) logger.warn(`[outbound-sync] ${conflicts.length} quote(s) held back due to CONFLICT; they remain queued and will be re-checked.`);
      if (otherFailed) logger.warn(`[outbound-sync] ${otherFailed} quote(s) failed to sync; they remain queued.`);
      return { pushed: results.length - failed.length, failed: failed.length, conflicts: conflicts.length };
    } catch (error) { logger.warn("[outbound-sync] Flush failed:", error.message); return { error: error.message }; }
    finally { running = false; }
  }

  return {
    isConfigured, flush,
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