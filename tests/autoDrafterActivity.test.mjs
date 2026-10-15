import assert from "node:assert/strict";
import test from "node:test";
import {autoDrafterActivityEvents, autoDrafterOutcomes, withAutoDrafterActivity} from "../src/features/autoDrafter/autoDrafterActivity.js";
import {buildQuoteLifecycleReport} from "../src/features/quoteDashboard/quoteLifecycle.js";
import {quoteDisplayMetric} from "../src/features/supervisorDashboard/kpiDisplayMode.js";
import {quoteContributingRecords} from "../src/features/supervisorDashboard/contributingRecords.js";

const now = Date.parse("2026-10-15T12:00:00.000Z");
const range = {start: "2026-10-14", end: "2026-10-14"};
const records = [
  {id: "100", caseNumber: "100", siteId: "S1", quoteNumber: "AI-1", draft: {items: []}, generatedAt: "2026-10-14T15:00:00.000Z"},
  {id: "200", caseNumber: "200", siteId: "S2", removedFromAutoDrafter: {reason: "quote_not_needed", note: "Customer declined", removedBy: "cr@x.com", removedAt: "2026-10-14T16:00:00.000Z"}},
  {id: "300", caseNumber: "300", draft: {items: []}, generatedAt: "2026-10-14T15:00:00.000Z", sentToQuotes: true, realQuoteNumber: "Q-9", realQuoteId: "q9", sentAt: "2026-10-14T17:00:00.000Z"},
  {id: "400", caseNumber: "0400", draft: {items: []}, generatedAt: "2026-10-14T15:00:00.000Z"}
];
const quotes = [
  {id: "q9", quote_number: "Q-9", case_number: "300", created_date: "2026-10-14T17:00:00.000Z", status: "draft_without_internal",
    status_history: [{status: "draft_without_internal", changed_at: "2026-10-14T17:00:00.000Z"}]},
  {id: "q4", quote_number: "Q-4", case_number: "400", created_date: "2026-10-14T18:00:00.000Z", status: "draft_without_internal",
    status_history: [{status: "draft_without_internal", changed_at: "2026-10-14T18:00:00.000Z"}]}
];

test("drafts count as created once and removals count as worked", () => {
  const events = autoDrafterActivityEvents(records, quotes, now);
  assert.deepEqual(events.map(event => [event.quote.case_number, event.kind]), [["100", "created"], ["200", "auto_drafter_removed"]]);
  const report = withAutoDrafterActivity(buildQuoteLifecycleReport(quotes, {range, now}), records, {quotes, range, now});
  assert.equal(quoteDisplayMetric(report, "created", range, "period_total").value, 3);
  assert.equal(quoteDisplayMetric(report, "worked", range, "period_total").value, 1);
  assert.equal(report.workedQuotes, 1);
  const worked = quoteContributingRecords(report, "worked");
  assert.equal(worked[0].quote.auto_drafter_case, "200");
  assert.match(worked[0].events[0].reason, /Customer declined/);
});

test("events outside the period are ignored", () => {
  const report = buildQuoteLifecycleReport([], {range: {start: "2026-10-10", end: "2026-10-10"}, now});
  assert.equal(withAutoDrafterActivity(report, records, {range: {start: "2026-10-10", end: "2026-10-10"}, now}), report);
});

test("outcomes show where every case went", () => {
  const byCase = Object.fromEntries(autoDrafterOutcomes(records, quotes).map(row => [row.caseNumber, row]));
  assert.equal(byCase["100"].outcome, "awaiting");
  assert.equal(byCase["200"].outcome, "removed");
  assert.equal(byCase["200"].note, "Customer declined");
  assert.equal(byCase["300"].outcome, "sent");
  assert.equal(byCase["300"].quoteNumber, "Q-9");
  assert.equal(byCase["0400"].outcome, "quoted");
  assert.equal(byCase["0400"].quoteNumber, "Q-4");
});
