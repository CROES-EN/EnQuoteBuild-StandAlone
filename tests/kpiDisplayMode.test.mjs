import test from "node:test";
import assert from "node:assert/strict";
import {dailyCountValue, displayCount, displayModeRecords, quoteDisplayMetric} from "../src/features/supervisorDashboard/kpiDisplayMode.js";
import {AGGREGATION_MODES as modes} from "../src/features/supervisorDashboard/periodAggregation.js";

test("Quote modes preserve period uniqueness, daily uniqueness and zero-activity days", () => {
  const event = (id, day) => ({quote: {id}, kind: "follow_up", at: Date.parse(`2026-10-0${day}T12:00:00`)});
  const report = {activity: [event("a", 1), event("a", 1), event("a", 2), event("b", 2)]};
  const range = {start: "2026-10-01", end: "2026-10-03"};
  assert.equal(quoteDisplayMetric(report, "worked", range, modes.PERIOD_TOTAL).value, 2);
  assert.equal(quoteDisplayMetric(report, "worked", range, modes.DAILY_AVERAGE).value, 1);
  assert.equal(quoteDisplayMetric(report, "worked", range, modes.LATEST_DAY).value, 0);
  const latest = quoteDisplayMetric(report, "worked", {...range, end: "2026-10-02"}, modes.LATEST_DAY);
  assert.equal(latest.value, 2);
  assert.equal(latest.activity.length, 2);
});

test("Imported modes average dated values and scope latest-day contributing records", () => {
  const records = [{date: "2026-10-01", value: 10}, {date: "2026-10-02", value: 20}];
  assert.equal(displayCount(records, modes.PERIOD_TOTAL), 30);
  assert.equal(displayCount(records, modes.DAILY_AVERAGE), 15);
  const latest = displayModeRecords(records, {start: "2026-10-01", end: "2026-10-03"}, modes.LATEST_DAY);
  assert.deepEqual(latest, [records[1]]);
  assert.equal(displayCount(latest, modes.LATEST_DAY), 20);
  assert.equal(displayCount([], modes.PERIOD_TOTAL), null);
  assert.equal(dailyCountValue(30, [...records, records[0]], modes.DAILY_AVERAGE), 15);
});
