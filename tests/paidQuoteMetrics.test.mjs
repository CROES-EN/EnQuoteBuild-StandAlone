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
const {buildPaidQuoteSnapshot, PAID_QUOTE_STATUSES} = module.exports;

test("live snapshot includes exactly four paid statuses, all dates, and reportable current versions", () => {
  const quotes = PAID_QUOTE_STATUSES.map((status, i) => ({id: `paid-${i}`, status, total: [1250.25, "20.00", 30, 40][i], created_date: "2020-01-01"}));
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
