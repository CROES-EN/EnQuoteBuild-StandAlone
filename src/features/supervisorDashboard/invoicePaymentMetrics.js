import {parseHistoryDate} from "./caseWorkMetrics.js";
import {diffDays} from "./dateRanges.js";
import {AGGREGATION_MODES} from "./periodAggregation.js";

export const PAYMENT_COLUMNS = ["Invoice ID", "Paid Date", "Amount Paid", "Currency"];

export function buildInvoicePaymentReport(rows, range, mode = AGGREGATION_MODES.PERIOD_TOTAL) {
  const byId = new Map();
  const invalid = [];
  for (const row of rows) {
    const id = String(row["Invoice ID"] ?? "").trim();
    const paid = parseHistoryDate(row["Paid Date"]);
    const raw = String(row["Amount Paid"] ?? "").trim();
    const amount = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw) ? Number(raw.replaceAll(",", "")) : NaN;
    const currency = String(row.Currency ?? "").trim().toUpperCase();
    if (!id || !paid || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) {
      invalid.push({row, reason: "Missing/invalid Invoice ID, Paid Date, Amount Paid, or Currency"});
      if (id) byId.set(id, null);
      continue;
    }
    const event = {id, row, date: paid.date, amount, currency};
    if (!byId.has(id)) byId.set(id, event);
    else {
      const prior = byId.get(id);
      if (!prior || prior.date !== event.date || prior.amount !== amount || prior.currency !== currency) {
        byId.set(id, null);
        invalid.push({row, reason: "Conflicting rows for the same Invoice ID"});
      }
    }
  }
  const records = [...byId.values()].filter(event => event && event.date >= range.start && event.date <= range.end &&
    (mode !== AGGREGATION_MODES.LATEST_DAY || event.date === range.end));
  const currencies = [...new Set(records.map(event => event.currency))];
  const divisor = mode === AGGREGATION_MODES.DAILY_AVERAGE ? diffDays(range.start, range.end) + 1 : 1;
  if (!(divisor > 0)) throw new Error("Invoice daily average requires a valid reporting period.");
  return {records, invalid, count: records.length / divisor, currencies,
    amount: currencies.length > 1 ? null : records.reduce((sum, event) => sum + Math.round(event.amount * 100), 0) / 100 / divisor};
}
