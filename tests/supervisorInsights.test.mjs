import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDrafterAccuracy,
  buildBacklogFlow,
  buildHygieneHeatmap,
  buildHygieneTrend,
  buildPanelRmaCycleMetrics,
  describeFreshness,
  draftInsightBullets,
  hygieneSnapshotFromReport,
  importFreshnessSource,
  priorBusinessDate
} from "../src/features/supervisorDashboard/supervisorInsights.js";

const snapshot = (ids, overdue = []) => ({
  count: ids.length,
  rows: ids.map(id => ({quote: {id, quote_number: `Q-${id}`}, alert: {overdueHours: overdue.includes(id) ? 5 : 0}}))
});

test("priorBusinessDate skips weekends", () => {
  assert.equal(priorBusinessDate(new Date(2026, 4, 18, 9)), "2026-05-15"); // Monday -> Friday
  assert.equal(priorBusinessDate(new Date(2026, 4, 20, 9)), "2026-05-19");
});

test("describeFreshness flags imports older than the prior business day", () => {
  const now = new Date(2026, 4, 20, 9);
  assert.equal(describeFreshness({kind: "live"}, now).tone, "live");
  assert.equal(describeFreshness(null, now), null);
  const fresh = describeFreshness({kind: "import", name: "Staffing", importedAt: new Date(2026, 4, 19, 17).toISOString(), importMethod: "auto"}, now);
  assert.equal(fresh.stale, false);
  assert.match(fresh.text, /^Auto-imported .* · Staffing$/);
  const stale = describeFreshness({kind: "import", name: "Staffing", importedAt: new Date(2026, 4, 15, 17).toISOString()}, now);
  assert.equal(stale.stale, true);
  assert.equal(stale.tone, "stale");
  assert.equal(describeFreshness({kind: "missing", name: "EODB"}, now).tone, "missing");
  assert.equal(describeFreshness({kind: "daily", name: "Case Backlog", latestDate: "2026-05-19"}, now).stale, false);
  assert.equal(describeFreshness({kind: "daily", name: "Case Backlog", latestDate: "2026-05-11"}, now).stale, true);
  assert.equal(describeFreshness({kind: "daily", name: "Case Backlog", latestDate: null}, now).tone, "missing");
});

test("importFreshnessSource uses the oldest of several inputs", () => {
  const tables = {a: {importedAt: "2026-05-19T10:00:00Z", importMethod: "auto"}, b: {importedAt: "2026-05-12T10:00:00Z", importMethod: "manual"}};
  assert.deepEqual(importFreshnessSource(tables, ["a", "b"], "Calls"), {kind: "import", name: "Calls", importedAt: "2026-05-12T10:00:00Z", importMethod: "manual"});
  assert.deepEqual(importFreshnessSource(tables, ["c"], "Missing"), {kind: "missing", name: "Missing"});
});

test("buildBacklogFlow compares each captured day with the previous captured day", () => {
  const rows = buildBacklogFlow([
    {date: "2026-05-19", snapshot: snapshot(["1", "2", "4"], ["4"])},
    {date: "2026-05-17", snapshot: snapshot(["1", "2", "3"])},
    {date: "2026-05-18", snapshot: null}
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {date: "2026-05-17", opening: null, added: null, left: null, closing: 3, overdue: 0,
    comparedTo: null, addedQuotes: [], leftQuotes: []});
  assert.equal(rows[1].opening, 3);
  assert.equal(rows[1].added, 1);
  assert.equal(rows[1].left, 1);
  assert.equal(rows[1].closing, 3);
  assert.equal(rows[1].overdue, 1);
  assert.equal(rows[1].comparedTo, "2026-05-17");
  assert.deepEqual(rows[1].addedQuotes, ["Q-4"]);
  assert.deepEqual(rows[1].leftQuotes, ["Q-3"]);
});

const report = {
  importedAt: "2026-05-19T15:00:00Z", sourceFileName: "cases.xlsx",
  records: [{author: "Ann", flags: []}, {author: "Ann", flags: []}, {author: "Bob", flags: []}],
  flagged: [{}, {}],
  issues: [{issue: "Missing site ID", cases: 2}, {issue: "Missing scope", cases: 1}],
  authors: [
    {author: "Ann", requests: 2, flagged: 2, issues: {"Missing site ID": 2, "Missing scope": 1}},
    {author: "Bob", requests: 1, flagged: 0, issues: {}}
  ]
};

test("buildHygieneHeatmap counts issues per flagged author", () => {
  const heatmap = buildHygieneHeatmap(report);
  assert.deepEqual(heatmap.issues, ["Missing site ID", "Missing scope"]);
  assert.equal(heatmap.rows.length, 1);
  assert.deepEqual(heatmap.rows[0].cells, [{issue: "Missing site ID", count: 2, rate: 100}, {issue: "Missing scope", count: 1, rate: 50}]);
  assert.equal(heatmap.max, 2);
  assert.deepEqual(buildHygieneHeatmap(null), {issues: [], rows: [], max: 0});
});

test("hygiene snapshots build a date-ordered trend", () => {
  const today = hygieneSnapshotFromReport(report, "2026-05-19");
  assert.equal(today.id, "hygiene:2026-05-19");
  assert.equal(today.requests, 3);
  assert.equal(today.flagged, 2);
  const trend = buildHygieneTrend([today, {date: "2026-05-18", requests: 4, flagged: 1, issues: {"Missing scope": 3}}, {date: "2026-05-17", is_deleted: true}]);
  assert.deepEqual(trend.rows.map(row => [row.date, row.rate]), [["2026-05-18", 25], ["2026-05-19", 67]]);
  assert.deepEqual(trend.issues, ["Missing scope", "Missing site ID"]);
});

test("buildAutoDrafterAccuracy summarizes sends, confidence and weak phrases", () => {
  const result = buildAutoDrafterAccuracy([
    {caseNumber: "100", sentToQuotes: true, editedBeforeSend: false, draft: {items: [
      {confidence: "high", name: "Microinverter"},
      {confidence: "low", requested_name: "Mystery widget"}
    ]}},
    {caseNumber: "101", sentToQuotes: true, editedBeforeSend: true, draft: {items: [
      {requested_name: "mystery  WIDGET"},
      {confidence: "low", requested_name: "Mystery widget"}
    ]}},
    {caseNumber: "102", is_deleted: true, sentToQuotes: true, draft: {items: [{confidence: "low", name: "x"}]}}
  ], [{taughtAt: "2026-05-01"}, {taughtAt: "2026-05-03"}, {is_deleted: true}]);
  assert.equal(result.drafts, 2);
  assert.equal(result.sent, 2);
  assert.equal(result.sentUnedited, 1);
  assert.equal(result.uneditedRate, 50);
  assert.deepEqual(result.confidence, {high: 1, medium: 1, low: 2});
  assert.equal(result.highRate, 25);
  assert.deepEqual(result.topPhrases, [{phrase: "Mystery widget", notInCatalog: 2, needsReview: 1, total: 3, cases: 2}]);
  assert.equal(result.learnedSwaps, 2);
  assert.equal(result.recentSwaps[0].taughtAt, "2026-05-03");
});

test("buildPanelRmaCycleMetrics measures close time, open age and status dwell", () => {
  const now = new Date("2026-05-21T00:00:00Z");
  const metrics = buildPanelRmaCycleMetrics([
    {id: "a", panel_manufacturer: "Jinko", current_status: "Closed", created_date: "2026-05-01T00:00:00Z", status_history: [
      {new_status: "New", changed_at: "2026-05-01T00:00:00Z"},
      {new_status: "RMA Submitted", changed_at: "2026-05-03T00:00:00Z"},
      {new_status: "Approved", changed_at: "2026-05-07T00:00:00Z"},
      {new_status: "Closed", changed_at: "2026-05-11T00:00:00Z"}
    ]},
    {id: "b", panel_manufacturer: "jinko ", current_status: "RMA Submitted", created_date: "2026-05-11T00:00:00Z", status_history: [
      {new_status: "RMA Submitted", changed_at: "2026-05-16T00:00:00Z"}
    ]},
    {id: "c", panel_manufacturer: "", current_status: "New", created_date: "2026-05-19T00:00:00Z"},
    {id: "d", is_deleted: true, created_date: "2026-05-01T00:00:00Z"}
  ], now);
  assert.equal(metrics.open, 2);
  assert.equal(metrics.closed, 1);
  assert.equal(metrics.avgDaysToClose, 10);
  const jinko = metrics.manufacturers.find(item => item.manufacturer === "Jinko");
  assert.deepEqual({open: jinko.open, closed: jinko.closed, avgOpenAge: jinko.avgOpenAge, avgDaysToSubmit: jinko.avgDaysToSubmit, avgDecisionDays: jinko.avgDecisionDays},
    {open: 1, closed: 1, avgOpenAge: 10, avgDaysToSubmit: 3.5, avgDecisionDays: 4});
  assert.ok(metrics.manufacturers.some(item => item.manufacturer === "Unknown manufacturer"));
  assert.deepEqual(metrics.oldestOpen.map(item => [item.id, item.daysOpen, item.daysInStatus]), [["b", 10, 5], ["c", 2, 2]]);
  const submitted = metrics.statusDwell.find(item => item.status === "RMA Submitted");
  assert.deepEqual(submitted, {status: "RMA Submitted", avgDays: 4.5, visits: 2, currentlyIn: 1});
});

test("draftInsightBullets writes one sentence per available insight", () => {
  const bullets = draftInsightBullets({
    backlogFlow: {opening: 40, added: 3, left: 4, closing: 39, overdue: 2},
    hygiene: {requests: 10, flagged: 3, issues: {"Missing scope": 1, "Missing site ID": 2}},
    drafter: {sent: 4, sentUnedited: 3, uneditedRate: 75, confidence: {low: 1}},
    rma: {open: 2, oldestOpen: [{daysOpen: 12, manufacturer: "Jinko", status: "RMA Submitted"}]}
  });
  assert.deepEqual(bullets, [
    "Quote backlog 39 (opened at 40: +3 new, -4 left the backlog); 2 overdue.",
    "3 of 10 quote requests (30%) need intake correction; most common flag: Missing site ID (2).",
    "3 of 4 Auto-Drafter quotes (75%) were sent without edits; 1 draft line item was not in the catalog.",
    "2 open Panel RMAs; oldest is 12 days (Jinko, RMA Submitted)."
  ]);
  assert.deepEqual(draftInsightBullets({}), []);
});
