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
  if (quote.quote_number) identifiers.push({ field: "quote_number", value: quote.quote_number });
  identifiers.push({ field: "local_quote_id", value: quote.id });
  for (const filter of identifiers) {
    const q = url + "?q=" + encodeURIComponent(JSON.stringify({ [filter.field]: filter.value })) + "&limit=1";
    const response = await requestJson(q, { headers: authHeaders(env) });
    if (!response.ok) continue;
    const rows = Array.isArray(response.body) ? response.body : response.body?.items;
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.id) continue;

    // VERIFY: the returned record must actually match the search criteria
    const matched = rows[0];
    if (filter.field === "quote_number") {
      if (matched.quote_number !== filter.value) continue;
    } else if (filter.field === "local_quote_id") {
      if (matched.local_quote_id !== filter.value) continue;
    }

    return String(matched.id);
  }
  return null;
}

async function findRemoteQuoteByLocalId(env, localId) {
  const query = encodeURIComponent(JSON.stringify({ local_quote_id: localId }));
  const response = await requestJson(
    `${entityUrl(env, "Quote")}?q=${query}&limit=1`,
    { headers: authHeaders(env) }
  );
  if (!response.ok) throw new RetryableError(`could not locate the Base44 quote: ${response.status}`);
  const rows = Array.isArray(response.body) ? response.body : response.body?.items;
  const candidate = Array.isArray(rows) ? rows[0] : null;
  if (!candidate?.id || candidate.local_quote_id !== localId) return null;
  return String(candidate.id);
}

async function fetchRemoteQuote(env, remoteId) {
  const response = await requestJson(`${entityUrl(env, "Quote")}/${encodeURIComponent(String(remoteId))}`, {
    headers: authHeaders(env)
  });
  if (response.status === 404) return { ok: false, notFound: true };
  if (!response.ok || !response.body || typeof response.body !== "object") return { ok: false, error: "Could not read Base44's current copy" };
  return { ok: true, quote: response.body };
}

async function pushCreate(env, item) {
  if (!item.quote) throw new Error("quote create/update requires a quote payload");
  const existingId = await findExisting(env, item.quote);
  if (existingId) {
    // HARDENING FIX (confirmed real bug tonight - two separate quotes each silently
    // "adopted" a COMPLETELY UNRELATED real Base44 quote's ID): findExisting()'s search
    // response alone is not trustworthy enough to adopt on - whether Base44's search API
    // returns wrong results, or the search response's fields don't reflect the real
    // record, a single search hit must never be treated as confirmed. CONFIRM: the
    // candidate must be independently re-fetched BY ID and BOTH quote_number and
    // local_quote_id must match the local quote before it is ever adopted. If the fetch
    // fails, or either field mismatches, this is NOT a real match - fall through and
    // create a genuinely new record instead, exactly the safe behavior both false
    // adoptions tonight should have had.
    const confirmCheck = await fetchRemoteQuote(env, existingId);
    if (confirmCheck.ok && confirmCheck.quote) {
      const confirmedQuoteNumber = confirmCheck.quote.quote_number;
      const confirmedLocalId = confirmCheck.quote.local_quote_id;
      const quoteNumberOk = !item.quote.quote_number || confirmedQuoteNumber === item.quote.quote_number;
      const localIdOk = confirmedLocalId === item.quote.id;
      if (quoteNumberOk && localIdOk) {
        return { status: "adopted", remote_id: existingId };
      }
      // Candidate failed independent confirmation - do NOT adopt. Fall through to create.
    }
    // Fetch failed, or confirmation mismatched - fall through to create a new record.
  }
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
  const url = `${entityUrl(env, "Quote")}/${encodeURIComponent(String(item.remoteId))}`;
  const response = await requestJson(url, { method: "PUT", headers: authHeaders(env), body: toRemotePayload(item.quote) });
  if (!response.ok) throw new RetryableError(`update failed: ${response.status}`);
  const confirmedId = response.body?.id ? String(response.body.id) : null;
  if (!confirmedId || confirmedId !== String(item.remoteId)) throw new RetryableError(`update not confirmed (expected ${item.remoteId}, got ${confirmedId})`);
  return { status: "pushed", remote_id: confirmedId };
}

async function pushDelete(env, item) {
  const localId = String(item.localId || item.quote?.id || "");
  if (!localId) throw new Error("Quote deletion is missing its local id.");
  const isLocallyCreated = /^demo-quote-\d{10,}-[a-z0-9]{4,}$/.test(localId);
  let remoteId = item.remoteId ? String(item.remoteId) : (isLocallyCreated ? null : localId);

  if (!remoteId) {
    remoteId = await findRemoteQuoteByLocalId(env, localId);
    if (!remoteId) return { status: "deleted", remote_id: null };
  }

  const remoteCheck = await fetchRemoteQuote(env, remoteId);
  if (remoteCheck.notFound) return { status: "deleted", remote_id: remoteId };
  if (!remoteCheck.ok) throw new RetryableError(`could not verify quote before deletion: ${remoteCheck.error}`);
  if (isLocallyCreated && remoteCheck.quote.local_quote_id !== localId) {
    throw new Error("Refusing to delete a Base44 quote that does not match this local quote.");
  }
  if (!isLocallyCreated && String(remoteCheck.quote.id || "") !== remoteId) {
    throw new Error("Refusing to delete a Base44 quote whose id does not match the requested id.");
  }

  const response = await requestJson(`${entityUrl(env, "Quote")}/${encodeURIComponent(remoteId)}`, {
    method: "DELETE",
    headers: authHeaders(env)
  });
  if (!response.ok && response.status !== 404) {
    throw new RetryableError(`delete failed: ${response.status}`);
  }
  return { status: "deleted", remote_id: remoteId };
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

// All 20 entity types Base44 now sends, other than "quote" (which has its own
// dedicated pushCreate/pushUpdate above, including conflict-checking against
// the remote copy via fetchRemoteQuote - that logic is quote-specific and is
// intentionally NOT duplicated here). "dismissal" and "mention" also keep
// their own existing handlers below and are excluded from this generic list.
//
// Confirmed directly with Base44 (see chat log) - these are the exact Base44
// entity names as they exist in the app today.
const GENERIC_ENTITY_NAMES = new Set([
  "Product",
  "MaterialOrder",
  "QuoteAlert",
  "PriceReview",
  "QuoteReview",
  "QuoteActivity",
  "QuoteDeletionRequest",
  "FollowUpConfig",
  "FollowUpLog",
  "EmailDistribution",
  "PDFTemplate",
  "FST",
  "PVManufacturer",
  "PVPanelRMA",
  "SiteFlag",
  "SVCancelTracker",
  "SupportInteraction",
  "Invitation",
]);

// Generic create/update push for any of the entity names above. Base44's
// outbound envelope for these is: { entityType, action, localId, record }.
// Unlike quotes, these do NOT run a remote-conflict check before updating -
// Base44 confirmed these entities don't need that (no concurrent-edit
// scenario like quotes have), and QuoteActivity/FollowUpLog in particular are
// append-only logs that are only ever created, never updated.
async function pushGenericEntity(env, entityName, item) {
  const isUpdate = item.action === "update" && item.remoteId;
  const url = isUpdate ? `${entityUrl(env, entityName)}/${item.remoteId}` : entityUrl(env, entityName);
  const method = isUpdate ? "PUT" : "POST";
  const response = await requestJson(url, { method, headers: authHeaders(env), body: item.record });
  if (!response.ok) throw new RetryableError(`${entityName} ${item.action} failed: ${response.status}`);
  const confirmedId = response.body?.id ? String(response.body.id) : (item.remoteId || null);
  if (!confirmedId) throw new RetryableError(`${entityName} ${item.action} returned no id`);
  return { status: "pushed", remote_id: confirmedId };
}
export async function performPush(message, env) {
  const { entityType, action, ...rest } = message;
  if (entityType === "quote") {
    if (action === "delete") return await pushDelete(env, rest);
    return action === "update" ? await pushUpdate(env, rest) : await pushCreate(env, rest);
  }
  if (entityType === "dismissal") return await pushDismissal(env, rest);
  if (entityType === "mention") return await pushMention(env, rest);
  if (GENERIC_ENTITY_NAMES.has(entityType)) return await pushGenericEntity(env, entityType, { ...rest, action });
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