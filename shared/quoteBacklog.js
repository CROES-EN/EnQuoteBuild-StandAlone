import {computeQuoteAlert} from "./quoteSLA.js";

export const BACKLOG_TIME_ZONE = "America/Denver";

export function backlogDate(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BACKLOG_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildQuoteBacklog(quotes, nowMs = Date.now()) {
  const rows = quotes.filter(quote => quote.is_current_version !== false && !quote.exclude_from_reporting && quote.status !== "on_hold")
    .map(quote => ({quote, alert: computeQuoteAlert(quote, nowMs)}))
    .filter(row => row.alert);
  const statusCounts = {};
  for (const {quote} of rows) statusCounts[quote.status] = (statusCounts[quote.status] || 0) + 1;
  return {date: backlogDate(nowMs), timeZone: BACKLOG_TIME_ZONE, capturedAt: new Date(nowMs).toISOString(),
    count: rows.length, statusCounts,
    rows: rows.map(({quote, alert}) => ({
      quote: {id: quote.id, quote_number: quote.quote_number, site_id: quote.site_id, status: quote.status},
      alert
    }))};
}
