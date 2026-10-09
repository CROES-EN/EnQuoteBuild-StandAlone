import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";

const bundle = await build({
  entryPoints: [path.resolve("src\\features\\supervisorDashboard\\paidQuoteMetrics.js")],
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{
    name: "stub-data-client",
    setup(builder) {
      builder.onResolve({filter: /^@\/api\/dataClient$/}, () => ({path: "data-client", namespace: "stub"}));
      builder.onLoad({filter: /.*/, namespace: "stub"}, () => ({contents: "export function getQuotes() { throw new Error('not used'); }"}));
    }
  }]
});
const module = {exports: {}};
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const {buildPaidQuoteReport, getQuotePaidDate, PAID_QUOTE_STATUSES} = module.exports;
const range = {start: "2026-07-01", end: "2026-07-02"};
const buildPaidQuoteSnapshot = quotes => buildPaidQuoteReport(quotes.map(quote => ({paid_at_date: "2026-07-01", ...quote})), range);

test("paid report includes exactly four statuses and reportable current versions", () => {
  const quotes = PAID_QUOTE_STATUSES.map((status, i) => ({id: `paid-${i}`, status, total: [1250.25, "20.00", 30, 40][i], created_date: "2020-01-01", paid_at_date: "2026-07-01"}));
  const result = buildPaidQuoteSnapshot([...quotes,
    {id: "pending", status: "invoiced", total: 9000},
    {id: "other", status: "approved", total: 9000},
    {id: "older", status: "invoice_paid", total: 9000, is_current_version: false},
    {id: "excluded", status: "scheduled", total: 9000, exclude_from_reporting: true},
    {id: "parked", status: "on_hold", total: 9000}
  ]);
  assert.equal(result.count, 4);
  assert.equal(result.amount, 1340.25);
  assert.deepEqual(result.records, quotes);
  assert.deepEqual(result.invalid, []);
});

test("paid date controls inclusive range, latest day, averages and undated exclusions", () => {
  const quote = (id, dates) => ({id, status: "scheduled", total: 100, created_date: "2026-07-01", ...dates});
  const quotes = [
    quote("start", {paid_at_date: "2026-07-01"}),
    quote("end", {invoice_paid_date: "2026-07-02"}),
    quote("before", {paid_at_date: "2026-06-30"}),
    quote("after", {paid_at_date: "2026-07-03"}),
    quote("missing", {}),
    quote("invalid", {paid_at_date: "2026-02-30", invoice_paid_date: "2026-07-01"}),
    quote("preferred", {paid_at_date: "2026-06-30", invoice_paid_date: "2026-07-01"})
  ];
  const report = buildPaidQuoteReport(quotes, range);
  assert.deepEqual(report.records.map(quote => quote.id), ["start", "end"]);
  assert.equal(report.count, 2);
  assert.equal(report.amount, 200);
  assert.equal(report.undated.length, 2);
  const latest = buildPaidQuoteReport(quotes, range, "latest_day");
  assert.deepEqual(latest.records.map(quote => quote.id), ["end"]);
  assert.equal(latest.amount, 100);
  const average = buildPaidQuoteReport(quotes.slice(0, 1), range, "daily_average");
  assert.equal(average.count, 0.5);
  assert.equal(average.amount, 50);
  assert.equal(buildPaidQuoteReport(quotes, {start: "2026-08-01", end: "2026-08-02"}).count, 0);
  assert.equal(buildPaidQuoteReport([{status: "invoice_paid", total: "", paid_at_date: "2026-06-30"}], range).amount, 0, "invalid amounts outside the period do not invalidate its total");
  assert.equal(buildPaidQuoteReport(quotes.slice(0, 1), range, "latest_day").count, 0, "latest day is period end, not most recent payment day");
  assert.equal(getQuotePaidDate({paid_at_date: "2026-07-01"}), "2026-07-01");
  const timestamp = "2026-07-02T01:00:00Z";
  const local = new Date(timestamp);
  assert.equal(getQuotePaidDate({paid_at_date: timestamp}), `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`);
});

test("invalid totals never produce a misleading partial dollar sum or hide matching quotes", () => {
  for (const total of [null, undefined, "", " ", "unknown", -1, NaN, Infinity, true, []]) {
    const result = buildPaidQuoteSnapshot([{id: "good", status: "invoice_paid", total: 100}, {id: "bad", status: "scheduled", total}]);
    assert.equal(result.count, 2);
    assert.equal(result.amount, null);
    assert.equal(result.invalid.length, 1);
  }
  assert.equal(buildPaidQuoteSnapshot([{status: "scheduled", total: 0}]).amount, 0);
  assert.equal(buildPaidQuoteSnapshot([]).amount, 0);
  assert.equal(buildPaidQuoteSnapshot([{status: "scheduled", total: 0.1}, {status: "invoice_paid", total: 0.2}]).amount, 0.3);
});
