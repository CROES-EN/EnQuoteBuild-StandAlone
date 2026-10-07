import test from "node:test";
import assert from "node:assert/strict";
import {activeImproperRequests, assertRequestCanBeDrafted, createRequestReview, improperRequestMetric, validateRequestReview} from "../src/features/autoDrafter/improperQuoteRequests.js";
import {AGGREGATION_MODES as modes} from "../src/features/supervisorDashboard/periodAggregation.js";

const stamp = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const mark = (id, caseNumber, day) => ({
  id: `quote-request-review:${id}`, caseNumber, action: "mark", at: stamp(day),
  kind: "quote_request_review", version: 1, siteId: "123", reviewer: "reviewer@example.com",
  reason: "Not a valid request", markIds: []
});
const undo = (...events) => ({...mark("undo", events[0].caseNumber, 6), action: "undo", markIds: events.map(event => event.id)});

test("mark, undo and re-mark preserve history and prevent drafting while active", () => {
  const first = mark("first", " 00123 ", 4);
  const second = mark("second", "00123", 6);
  assert.throws(() => assertRequestCanBeDrafted([first], "00123"), /marked improper/);
  assert.doesNotThrow(() => assertRequestCanBeDrafted([first, undo(first)], "00123"));
  const events = [first, undo(first), second];
  assert.deepEqual(activeImproperRequests(events).get("00123").activeMarkIds, [second.id]);
  const metric = improperRequestMetric(events, {start: "2026-10-01", end: "2026-10-06"});
  assert.equal(metric.value, 1);
  assert.equal(metric.records[0].markingCount, 2);
  assert.equal(metric.records[0].firstMarkedAt, first.at);
  assert.equal(metric.records[0].at, second.at);
  assert.equal(metric.records[0].currentState, "Improper");
  assert.equal(improperRequestMetric([...events, undo(second)], {start: "2026-10-01", end: "2026-10-06"}).records[0].currentState, "Restored");
});

test("concurrent reviewers use independent events, and undo never cancels unseen marks", () => {
  const a = mark("a", "ABC", 6);
  const b = mark("b", "abc", 6);
  const events = [a, b, undo(a)];
  assert.deepEqual(activeImproperRequests(events).get("abc").activeMarkIds, [b.id]);
  assert.equal(improperRequestMetric(events, {start: "2026-10-06", end: "2026-10-06"}).value, 1);
  assert.equal(activeImproperRequests([a, b, undo(a, b)]).size, 0);
});

test("local date boundaries are inclusive and daily averages include zero days", () => {
  const events = [mark("before", "0", 3), mark("first", "1", 4), mark("repeat", "1", 4), mark("again", "1", 6), mark("other", "2", 6), mark("after", "3", 7)];
  events[1].at = stamp(4, 0);
  events[4].at = new Date(2026, 9, 6, 23, 59, 59, 999).toISOString();
  const range = {start: "2026-10-04", end: "2026-10-06"};
  assert.equal(improperRequestMetric(events, range).value, 2);
  assert.equal(improperRequestMetric(events, range, modes.DAILY_AVERAGE).value, 1);
  assert.equal(improperRequestMetric(events, range, modes.LATEST_DAY).value, 2);
  assert.equal(improperRequestMetric(events, {start: "2026-10-05", end: "2026-10-05"}, modes.DAILY_AVERAGE).value, 0);
  assert.throws(() => improperRequestMetric(events, {start: null, end: null}, modes.DAILY_AVERAGE), /valid reporting period/);
});

test("review creation validates input and creates independent immutable event IDs", () => {
  const first = createRequestReview({caseNumber: " 00123 ", reviewer: " USER@example.com ", reason: " note "});
  const second = createRequestReview({caseNumber: "00123", reviewer: "user@example.com"});
  assert.notEqual(first.id, second.id);
  assert.equal(first.caseNumber, "00123");
  assert.equal(first.reviewer, "user@example.com");
  assert.equal(first.reason, "note");
  assert.equal(validateRequestReview(first), first);
  assert.throws(() => createRequestReview({caseNumber: "", reviewer: "user@example.com"}), /case number/);
  assert.throws(() => createRequestReview({caseNumber: "1"}), /Sign in/);
  assert.throws(() => createRequestReview({caseNumber: "1", reviewer: "a", action: "undo"}), /no active mark/);
  assert.throws(() => validateRequestReview({...first, version: 2}), /invalid/);
});
