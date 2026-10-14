import test from "node:test";
import assert from "node:assert/strict";
import {evaluateGoldenQuote, goldenQuoteEvaluations, quoteContentSignature, requestSnapshot} from "../src/features/goldenQuotes/goldenQuotes.js";

const draft = {items: [{name: "AC Cabling", quantity: 1, unit_price: 50}], labor_hours: 2, travel_hours: 1, miles_traveled: 20, fst_count: 1};
const approvedQuote = (overrides = {}) => ({
  id: "q1", ...draft, status: "approved",
  status_history: [{status: "draft_without_internal"}, {status: "submitted"}, {status: "approved"}], ...overrides
});
const record = (overrides = {}) => ({
  caseNumber: "00123", sentToQuotes: true, realQuoteId: "q1", draft,
  sentSignature: quoteContentSignature(draft),
  requestSnapshot: requestSnapshot({type: "on_demand", label: "On-Demand only"}, {flags: [], author: "Agent"}), ...overrides
});

test("an approved, unedited, eligible quote from a clean request is Golden", () => {
  assert.deepEqual(evaluateGoldenQuote(record(), [approvedQuote()]), {golden: true, reasons: [], status: "approved"});
  for (const type of ["panel_and_quote", "enphase_and_quote"]) {
    assert.equal(evaluateGoldenQuote(record({requestSnapshot: {category: type, categoryLabel: type, hygieneFlagCount: 0}}), [approvedQuote()]).golden, true, type);
  }
});

test("pure RMA, LPUP/TPUP and unclassified requests are never Golden", () => {
  for (const [category, label] of [["panel_rma_only", "Panel RMA"], ["enphase_rma", "Enphase RMA"], ["lpup_tpup", "LPUP/TPUP"], ["unclassified", "Unclassified"]]) {
    const result = evaluateGoldenQuote(record({requestSnapshot: {category, categoryLabel: label, hygieneFlagCount: 0}}), [approvedQuote()]);
    assert.equal(result.golden, false, category);
    assert.match(result.reasons.join(" "), /not eligible/);
  }
});

test("hygiene flags, draft edits, quote edits, rejection and pending approval disqualify a quote", () => {
  const cases = [
    [record({requestSnapshot: {category: "on_demand", categoryLabel: "On-Demand only", hygieneFlagCount: 2}}), [approvedQuote()], /2 Data Hygiene flags/],
    [record({requestSnapshot: undefined}), [approvedQuote()], /SOP check was not recorded/],
    [record({editedBeforeSend: true}), [approvedQuote()], /edited before sending/],
    [record(), [approvedQuote({labor_hours: 3})], /edited after it was sent/],
    [record(), [approvedQuote({is_current_version: false}), approvedQuote({id: "q2", parent_quote_id: "q1"})], /edited after it was sent/],
    [record(), [approvedQuote({status_history: [{status: "rejected"}, {status: "approved"}]})], /rejected/],
    [record(), [approvedQuote({status: "submitted", status_history: [{status: "submitted"}]})], /not approved yet/],
    [record({sentToQuotes: false}), [approvedQuote()], /Not sent/],
    [record(), [], /could not be found/]
  ];
  for (const [input, quotes, reason] of cases) {
    const result = evaluateGoldenQuote(input, quotes);
    assert.equal(result.golden, false, String(reason));
    assert.match(result.reasons.join(" "), reason);
  }
});

test("later workflow statuses and homeowner rejection still count as internally approved", () => {
  assert.equal(evaluateGoldenQuote(record(), [approvedQuote({status: "invoice_paid", status_history: []})]).golden, true);
  assert.equal(evaluateGoldenQuote(record(), [approvedQuote({status: "ho_rejected"})]).golden, true);
});

test("legacy sends compare against the saved draft, and formatting differences are ignored", () => {
  assert.equal(evaluateGoldenQuote(record({sentSignature: undefined}),
    [approvedQuote({items: [{name: " ac cabling ", quantity: "1", unit_price: "50.00"}]})]).golden, true);
});

test("evaluations are indexed by local id, Base44 id and case", () => {
  const {byQuoteId, byCase} = goldenQuoteEvaluations([record(), {caseNumber: "999"}], [approvedQuote({base44_id: "remote-1"})]);
  assert.equal(byQuoteId.get("q1").golden, true);
  assert.equal(byQuoteId.get("remote-1").golden, true);
  assert.equal(byCase.get("00123").golden, true);
  assert.equal(byCase.has("999"), false);
});
