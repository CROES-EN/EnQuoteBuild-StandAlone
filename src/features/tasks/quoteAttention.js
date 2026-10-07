import {QUOTE_STATUSES, getStatusLabel} from "@/constants/quoteStatuses";
import {scopedKey} from "@/lib/userScopedStorage";

const PREFS_KEY = "enquote_tasks_quote_attention_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

export const QUOTE_ATTENTION_STATUS_OPTIONS = QUOTE_STATUSES
  .filter((status) => status.value !== "draft" && !status.localOnly)
  .map(({ value, label }) => ({ value, label }));

const VALID_STATUSES = new Set(QUOTE_ATTENTION_STATUS_OPTIONS.map((status) => status.value));

export function normalizeQuoteAttentionPrefs(value) {
  const statuses = Array.isArray(value?.statuses)
    ? [...new Set(value.statuses.filter((status) => VALID_STATUSES.has(status)))]
    : [];
  return { statuses, scope: value?.scope === "all" ? "all" : "mine" };
}

export function readQuoteAttentionPrefs(storage = globalThis.localStorage) {
  try {
    return normalizeQuoteAttentionPrefs(JSON.parse(storage.getItem(scopedKey(PREFS_KEY)) || "null"));
  } catch {
    return normalizeQuoteAttentionPrefs(null);
  }
}

export function writeQuoteAttentionPrefs(prefs, storage = globalThis.localStorage) {
  const normalized = normalizeQuoteAttentionPrefs(prefs);
  try {
    storage.setItem(scopedKey(PREFS_KEY), JSON.stringify(normalized));
  } catch { /* ignore */ }
  return normalized;
}

function normalizedStatus(status) {
  return !status || status === "draft" ? "draft_without_internal" : status;
}

function statusSince(quote, status) {
  const history = Array.isArray(quote.status_history) ? quote.status_history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (normalizedStatus(entry?.status) !== status) continue;
    const time = Date.parse(entry.changed_at || entry.timestamp || entry.date || "");
    if (!Number.isNaN(time)) return time;
  }
  const fallback = Date.parse(quote.updated_date || quote.created_date || "");
  return Number.isNaN(fallback) ? null : fallback;
}

// Live list of current quotes in the user's chosen statuses, longest-waiting first.
export function selectQuotesNeedingAttention(quotes, prefs, userEmail, now = Date.now()) {
  const { statuses, scope } = normalizeQuoteAttentionPrefs(prefs);
  if (!statuses.length) return [];
  const wanted = new Set(statuses);
  const me = String(userEmail || "").trim().toLowerCase();
  if (scope === "mine" && !me) return [];
  return (quotes || [])
    .filter((quote) => quote && quote.is_current_version !== false)
    .map((quote) => ({ quote, status: normalizedStatus(quote.status) }))
    .filter(({ quote, status }) => wanted.has(status)
      && (scope === "all" || String(quote.owner_email || quote.created_by || "").trim().toLowerCase() === me))
    .map(({ quote, status }) => {
      const since = statusSince(quote, status);
      return {
        quote,
        status,
        statusLabel: getStatusLabel(status) || status,
        since,
        daysInStatus: since === null ? null : Math.max(0, Math.floor((now - since) / DAY_MS))
      };
    })
    .sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
}
