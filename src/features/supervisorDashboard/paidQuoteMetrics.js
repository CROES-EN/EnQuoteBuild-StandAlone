import {isReportableQuote} from "./quoteOpsMetrics";
import {parseISO, isValid} from "date-fns";
import {diffDays, toDateStr} from "./dateRanges.js";
import {AGGREGATION_MODES} from "./periodAggregation.js";
export const PAID_QUOTE_STATUSES = ["invoice_paid", "invoice_paid_materials_required", "materials_pending_shipment", "scheduled"];

export function hasValidQuoteTotal(quote) {
  return (typeof quote.total === "number" || typeof quote.total === "string") &&
    String(quote.total).trim() !== "" && Number.isFinite(Number(quote.total)) && Number(quote.total) >= 0;
}

export function getQuotePaidDate(quote) {
  const raw = quote.paid_at_date || quote.invoice_paid_date;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = parseISO(raw);
  return isValid(parsed) ? toDateStr(parsed) : null;
}

export function buildPaidQuoteReport(quotes, range, mode = AGGREGATION_MODES.PERIOD_TOTAL) {
  const candidates = quotes.filter(quote => isReportableQuote(quote) && PAID_QUOTE_STATUSES.includes(quote.status));
  const undated = candidates.filter(quote => !getQuotePaidDate(quote));
  const records = candidates.filter(quote => {
    const date = getQuotePaidDate(quote);
    return date && date >= range.start && date <= range.end &&
      (mode !== AGGREGATION_MODES.LATEST_DAY || date === range.end);
  });
  const invalid = records.filter(quote => !hasValidQuoteTotal(quote));
  const divisor = mode === AGGREGATION_MODES.DAILY_AVERAGE ? diffDays(range.start, range.end) + 1 : 1;
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error("Invoice daily average requires a valid reporting period.");
  return {
    records,
    count: records.length / divisor,
    invalid,
    undated,
    amount: invalid.length ? null : records.reduce((sum, quote) => sum + Math.round(Number(quote.total) * 100), 0) / 100 / divisor
  };
}
