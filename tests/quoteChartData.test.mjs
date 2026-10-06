import test from "node:test";
import assert from "node:assert/strict";
import {activityChartData, agingChartData, turnaroundChartData} from "../src/features/quoteDashboard/quoteChartData.js";
import {loadAllActivityPages} from "../src/features/quoteDashboard/loadQuoteActivities.js";

test("Activity chart fills zero days without changing event totals", () => {
  const result = activityChartData([
    {date: "2026-10-01", created: 2, transitions: 1},
    {date: "2026-10-03", created: 0, transitions: 3}
  ], {start: "2026-10-01", end: "2026-10-03"});
  assert.equal(result.interval, "daily");
  assert.deepEqual(result.data, [
    {date: "2026-10-01", created: 2, transitions: 1},
    {date: "2026-10-02", created: 0, transitions: 0},
    {date: "2026-10-03", created: 0, transitions: 3}
  ]);
});

test("Long ranges are bucketed weekly/monthly without losing totals", () => {
  for (const [start, end, interval] of [
    ["2026-01-01", "2026-10-01", "weekly"], ["2024-01-01", "2026-10-01", "monthly"]
  ]) {
    const result = activityChartData([
      {date: start, created: 3, transitions: 5}, {date: end, created: 2, transitions: 7}
    ], {start, end});
    assert.equal(result.interval, interval);
    assert.equal(result.data.reduce((sum, row) => sum + row.created, 0), 5);
    assert.equal(result.data.reduce((sum, row) => sum + row.transitions, 0), 12);
    assert.ok(result.data.length < 100);
  }
  assert.deepEqual(activityChartData([], {}), {data: [], interval: "daily"});
});

test("Aging chart uses exact thresholds and keeps unknown separate", () => {
  const result = agingChartData([0, 23.99, 24, 72, 168, 336, null].map(currentHours => ({currentHours})));
  assert.deepEqual(result.map(row => row.count), [2, 1, 1, 1, 1, 1]);
});

test("Turnaround chart converts hours to days without rounding underlying values", () => {
  const [row] = turnaroundChartData([{from: "submitted", to: "approved", count: 4, average: 36, median: 24, longest: 72}]);
  assert.equal(row.averageDays, 1.5);
  assert.equal(row.medianDays, 1);
  assert.equal(row.longestDays, 3);
  assert.equal(row.count, 4);
});

test("Activity loader paginates past the first page, including a full final page", async () => {
  const calls = [];
  const records = Array.from({length: 1000}, (_, index) => ({id: `audit-${index}`}));
  const result = await loadAllActivityPages(async (sort, size, skip) => {
    calls.push([sort, size, skip]);
    return records.slice(skip, skip + size);
  });
  assert.equal(result.length, 1000);
  assert.deepEqual(calls, [["-action_at", 500, 0], ["-action_at", 500, 500], ["-action_at", 500, 1000]]);
});

test("Activity loader surfaces incomplete pagination, malformed data, and API failures", async () => {
  await assert.rejects(loadAllActivityPages(async () => [{}]), /missing or duplicate IDs/);
  await assert.rejects(loadAllActivityPages(async () => [{id: "repeat"}], 1), /duplicate IDs/);
  await assert.rejects(loadAllActivityPages(async () => ({items: []})), /invalid response/);
  await assert.rejects(loadAllActivityPages(async () => { throw new Error("Access denied"); }), /Access denied/);
});
