// Queue consumer + sync push: EnQuote -> Base44.
// Matches the real Base44 API format from the original outboundSync.cjs.

import { markOutboundStatus } from "./repository.js";
import { RetryableError } from "./util.js";

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

function entityUrl(env, entityName) {
  return `${String(env.BASE44_API_URL).replace(/\/+$/, "")}/api/apps/${env.BASE44_APP_ID}/entities/${entityName}`;
}

function authHeaders(env) {
  return { "X-App-Id": String(env.BASE44_APP_ID), api_key: env.BASE44_API_KEY };
}

async function requestJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const init = { method, headers: { Accept: "application/json", ...headers } };
  if (body != null) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  let parsed = null;
  try { parsed = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body: parsed };
}

async function findExisting(env, quote) {
  const url = entityUrl(env, "Quote");
  const identifiers = [];
  if (quote.quote_number) identifiers.push({ quote_number: quote.quote_number });
  identifiers.push({ local_quote_id: quote.id });
  for (const filter of identifiers) {
    const q = `${url}?q=${encodeURIComponent(JSON.stringify(filter))}&limit=1`;
    const response = await requestJson(q, { headers: authHeaders(env) });
    if (!response.ok) continue;
    const rows = Array.isArray(response.body) ? response.body : response.body?.items;
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.id) return String(rows[0].id);
  }
  return null;
}

async function fetchRemoteQuote(env, remoteId) {
  const response = await requestJson(`${entityUrl(env, "Quote")}/${remoteId}`, { headers: authHeaders(env) });
  if (response.status === 404) return { ok: false, notFound: true };
  if (!response.ok || !response.body || typeof response.body !== "object") return { ok: false, error: "Could not read Base44's current copy" };
  return { ok: true, quote: response.body };
}

async function pushCreate(env, item) {
  const existingId = await findExisting(env, item.quote);
  if (existingId) return { status: "adopted", remote_id: existingId };
  const url = entityUrl(env, "Quote");
  const response = await requestJson(url, { method: "POST", headers: authHeaders(env), body: toRemotePayload(item.quote) });
  if (!response.ok) throw new RetryableError(`create failed: ${response.status}`);
  const remoteId = response.body?.id ? String(response.body.id) : null;
  if (!remoteId) throw new RetryableError("create returned no id");
  return { status: "pushed", remote_id: remoteId };
}

async function pushUpdate(env, item) {
  const remoteCheck = await fetchRemoteQuote(env, item.remoteId);
  if (!remoteCheck.ok) {
    if (remoteCheck.notFound) return { status: "pushed", remote_id: null, notFound: true };
    throw new RetryableError(`could not verify: ${remoteCheck.error}`);
  }
  const remoteUpdatedAt = remoteCheck.quote?.updated_date ? Date.parse(remoteCheck.quote.updated_date) : NaN;
  const localBaseline = item.base44SyncedAt ? Date.parse(item.base44SyncedAt) : NaN;
  if (!Number.isNaN(remoteUpdatedAt) && !Number.isNaN(localBaseline) && remoteUpdatedAt > localBaseline) {
    return { status: "conflict", conflict_with: remoteCheck.quote.updated_date };
  }
  const url = `${entityUrl(env, "Quote")}/${item.remoteId}`;
  const response = await requestJson(url, { method: "PUT", headers: authHeaders(env), body: toRemotePayload(item.quote) });
  if (!response.ok) throw new RetryableError(`update failed: ${response.status}`);
  const confirmedId = response.body?.id ? String(response.body.id) : null;
  if (!confirmedId || confirmedId !== String(item.remoteId)) throw new RetryableError(`update not confirmed (expected ${item.remoteId}, got ${confirmedId})`);
  return { status: "pushed", remote_id: confirmedId };
}

async function pushDismissal(env, item) {
  const url = entityUrl(env, "StatusAlertDismissal");
  const response = await requestJson(url, { method: "POST", headers: authHeaders(env), body: { quote_id: item.quoteId } });
  if (!response.ok) throw new RetryableError(`dismissal failed: ${response.status}`);
  const confirmedId = response.body?.id ? String(response.body.id) : null;
  if (!confirmedId) throw new RetryableError("dismissal returned no id");
  return { status: "pushed", remote_id: confirmedId };
}

async function pushMention(env, item) {
  const url = entityUrl(env, "QuoteAlert");
  const response = await requestJson(url, {
    method: "POST",
    headers: authHeaders(env),
    body: {
      quote_id: item.quoteId,
      site_id: item.siteId || "",
      mentioned_email: item.mentionedEmail,
      mentioned_by: item.mentionedBy || "",
      message: item.message || "",
      priority: item.priority || "yellow",
      is_resolved: false,
    },
  });
  if (!response.ok) throw new RetryableError(`mention failed: ${response.status}`);
  const confirmedId = response.body?.id ? String(response.body.id) : null;
  if (!confirmedId) throw new RetryableError("mention returned no id");
  return { status: "pushed", remote_id: confirmedId };
}

export async function performPush(message, env) {
  const { entityType, action, ...rest } = message;
  if (entityType === "quote") {
    return action === "update" ? await pushUpdate(env, rest) : await pushCreate(env, rest);
  }
  if (entityType === "dismissal") return await pushDismissal(env, rest);
  if (entityType === "mention") return await pushMention(env, rest);
  throw new Error(`unknown entity type: ${entityType}`);
}

export async function pushToBase44(message, env) {
  const result = await performPush(message, env);
  await markOutboundStatus(env.DB, message.itemId, result.status, {
    conflictWith: result.conflict_with,
    remoteId: result.remote_id,
  });
  return result;
}