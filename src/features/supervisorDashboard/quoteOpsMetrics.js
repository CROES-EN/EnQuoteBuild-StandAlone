/**
 * Live "Quote Operations" figures for the O&M Daily Operations Snapshot, computed directly
 * from EnQuote's own local Quote + `status_history` data (via `getQuotes()` from
 * `@/api/dataClient` - the same call `SLAReporting.jsx` already uses). Unlike every other
 * Supervisor Dashboard tab, none of this is stored in `supervisorDailyMetrics` - it's derived
 * fresh every time it's needed, so it can never go stale or drift from the real quote data.
 *
 * Quote status vocabulary/terminal-status semantics are reused as-is from the rest of the app
 * (see `StuckQuotes.jsx` / `QuotePipelineFunnel.jsx` / `quoteSLA.js`), not reinvented here:
 *   - "Terminal" statuses (quote is no longer part of the open pipeline) = the same set
 *     `StuckQuotes.jsx` already uses: invoice_paid, scheduled, rejected, ho_rejected.
 *   - "Completed" (a quote successfully finished, for the Quotes Completed metric) defaults to
 *     the subset that `QuotePipelineFunnel.jsx` already calls its "paid" bucket: invoice_paid,
 *     scheduled - the point O&M work is billed/scheduled for execution. This is adjustable
 *     (the business has not formally ratified a single definition - see the spec's "if
 *     Completed has not been defined by the business, report the available status counts and
 *     flag the definition as pending" rule), and the exact set actually used should always be
 *     surfaced wherever this is displayed.
 */

import { getQuotes } from "@/api/dataClient";

export const TERMINAL_STATUSES = ["invoice_paid", "scheduled", "rejected", "ho_rejected"];
export const DEFAULT_COMPLETED_STATUSES = ["invoice_paid", "scheduled"];

/**
 * Matches the `is_current_version`/`exclude_from_reporting`/`on_hold` filtering already
 * established across every other reporting surface in this app (Dashboard.jsx, SLAReporting.jsx,
 * Quotes.jsx, QuoteOverview.jsx, RevenueAnalytics.jsx, ManagerDashboard.jsx, ...): only count a
 * quote's current version, skip anything explicitly excluded from reporting, and skip Boneyard
 * (on_hold) quotes - they've been intentionally parked outside the active pipeline, so they're
 * neither open backlog nor a completion.
 */
export function isReportableQuote(quote) {
  return Boolean(quote)
    && quote.is_current_version !== false
    && quote.status !== "on_hold"
    && !quote.exclude_from_reporting;
}

function parseTimestamp(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * [localMidnight(date), localMidnight(date + 1)) in the local system clock - "YYYY-MM-DD" is
 * already treated as a plain local calendar day everywhere else in this feature (see
 * `format.js`'s `formatDateLabel`), so this doesn't introduce a second timezone convention.
 */
export function getReportingWindow(dateStr) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * Determines whether a quote should be counted as terminal (no longer open backlog) as of a
 * given instant, reconstructed from its `status_history`. A quote is never considered terminal
 * before its FIRST recorded transition takes effect - it cannot have reached a terminal status
 * via a transition that, as far as the recorded history shows, hadn't happened yet by `asOfMs`
 * (adopting that future transition's destination status as if it had already happened would
 * wrongly exclude a genuinely-still-open quote from the backlog count).
 */
function isTerminalAsOf(quote, asOfMs) {
  const history = Array.isArray(quote.status_history) ? quote.status_history : [];
  const parsed = history
    .map(entry => ({ status: entry?.status, changedMs: parseTimestamp(entry?.changed_at) }))
    .filter(entry => entry.changedMs !== null)
    .sort((a, b) => a.changedMs - b.changedMs);

  const priorEntries = parsed.filter(entry => entry.changedMs <= asOfMs);
  if (priorEntries.length > 0) {
    return TERMINAL_STATUSES.includes(priorEntries[priorEntries.length - 1].status);
  }

  // asOfMs predates every recorded transition, so none of them had happened yet - the quote
  // can't have been terminal at that point regardless of what it later transitioned into.
  if (parsed.length > 0) return false;

  // No history at all - the quote's status has never changed, so its current status is accurate
  // for any timestamp at or after its creation.
  return TERMINAL_STATUSES.includes(quote.status);
}

function existedBy(quote, asOfMs) {
  const createdMs = parseTimestamp(quote.created_date);
  return createdMs !== null && createdMs <= asOfMs;
}

/** Distinct quotes first created ("drafted") within the window. */
export function computeQuotesDrafted(quotes, window) {
  return quotes.filter(quote => {
    const createdMs = parseTimestamp(quote.created_date);
    return createdMs !== null && createdMs >= window.startMs && createdMs < window.endMs;
  }).length;
}

/** Distinct quotes with a status_history transition into a Completed status within the window. */
export function computeQuotesCompleted(quotes, window, completedStatuses = DEFAULT_COMPLETED_STATUSES) {
  return quotes.filter(quote => {
    const history = Array.isArray(quote.status_history) ? quote.status_history : [];
    return history.some(entry => {
      if (!completedStatuses.includes(entry?.status)) return false;
      const changedMs = parseTimestamp(entry.changed_at);
      return changedMs !== null && changedMs >= window.startMs && changedMs < window.endMs;
    });
  }).length;
}

/** Count of quotes that exist by `asOfMs` and are not yet terminal as of that same instant. */
export function computeBacklogAsOf(quotes, asOfMs) {
  return quotes.filter(quote => existedBy(quote, asOfMs) && !isTerminalAsOf(quote, asOfMs)).length;
}

/**
 * Computes the full Quote Operations picture for one calendar date. `nowMs` caps "backlog at
 * end" at the current moment when the window's end is still in the future (e.g. reporting on
 * "today" before midnight) rather than projecting into a not-yet-happened future.
 */
export function computeQuoteOpsMetrics(rawQuotes, dateStr, { completedStatuses = DEFAULT_COMPLETED_STATUSES, nowMs = Date.now() } = {}) {
  const window = getReportingWindow(dateStr);
  if (!window) {
    return { window: null, quotesDrafted: null, quotesCompleted: null, backlogStart: null, backlogEnd: null, completedStatuses };
  }

  const quotes = (Array.isArray(rawQuotes) ? rawQuotes : []).filter(isReportableQuote);
  const backlogEndAsOfMs = Math.min(window.endMs, Math.max(nowMs, window.startMs));

  return {
    window,
    quotesDrafted: computeQuotesDrafted(quotes, window),
    quotesCompleted: computeQuotesCompleted(quotes, window, completedStatuses),
    backlogStart: computeBacklogAsOf(quotes, window.startMs),
    backlogEnd: computeBacklogAsOf(quotes, backlogEndAsOfMs),
    completedStatuses
  };
}

/**
 * Unreconciled Quote Requests / Quote Intake Gap = Salesforce Quotes Received (manual, no live
 * Salesforce integration exists yet) minus EnQuote Quotes Drafted (live-computed). This is an
 * APPROXIMATION, not a true Case Number <-> Quote ID match (no such mapping exists in this app) -
 * always label it as approximate wherever it's displayed.
 */
export function computeQuoteIntakeGap(sfQuotesReceived, quotesDrafted) {
  if (sfQuotesReceived === null || sfQuotesReceived === undefined) return null;
  if (quotesDrafted === null || quotesDrafted === undefined) return null;
  return sfQuotesReceived - quotesDrafted;
}

/** Thin wrapper so callers/tests don't need to import `getQuotes` directly. */
export async function fetchReportableQuotes() {
  const quotes = await getQuotes();
  return (quotes || []).filter(isReportableQuote);
}
