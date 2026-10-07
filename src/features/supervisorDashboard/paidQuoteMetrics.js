import {isReportableQuote} from "./quoteOpsMetrics";
export const PAID_QUOTE_STATUSES = ["invoice_paid", "invoice_paid_materials_required", "materials_pending_shipment", "scheduled"];

export function hasValidQuoteTotal(quote) {
  return (typeof quote.total === "number" || typeof quote.total === "string") &&
    String(quote.total).trim() !== "" && Number.isFinite(Number(quote.total)) && Number(quote.total) >= 0;
}

export function buildPaidQuoteSnapshot(quotes) {
  const records = quotes.filter(quote => isReportableQuote(quote) && PAID_QUOTE_STATUSES.includes(quote.status));
  const invalid = records.filter(quote => !hasValidQuoteTotal(quote));
  return {
    records,
    count: records.length,
    invalid,
    amount: invalid.length ? null : records.reduce((sum, quote) => sum + Math.round(Number(quote.total) * 100), 0) / 100
  };
}
