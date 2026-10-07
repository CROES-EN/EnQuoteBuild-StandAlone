import test from "node:test";
import assert from "node:assert/strict";
import {withQuoteAttribution} from "../src/features/notifications/notificationAttribution.js";

const notice = {type: "quote_updated", quoteId: "q", occurredAt: "2026-10-07T22:20:21.083334", changedBy: null};
const quote = {
  id: "q", updated_date: notice.occurredAt,
  status_history: [
    {changed_by: "older@example.com", changed_at: "2026-10-06T22:14:57Z"},
    {changed_by: "latest@example.com", changed_at: "2026-10-07T22:20:20.010Z"}
  ]
};

test("latest status author is available despite Base44 save latency, with an explicit source label", () => {
  const result = withQuoteAttribution(notice, quote);
  assert.equal(result.changedBy, "latest@example.com");
  assert.equal(result.attributionSource, "status_history");
  assert.equal(notice.changedBy, null, "stored notice remains unchanged");
});

test("recorded updaters take precedence over status history", () => {
  assert.equal(withQuoteAttribution({...notice, changedBy: "recorded@example.com"}, quote).changedBy, "recorded@example.com");
  const result = withQuoteAttribution(notice, {...quote, last_updated_by: "editor@example.com"});
  assert.equal(result.changedBy, "editor@example.com");
  assert.equal(result.attributionSource, undefined);
});

test("current history is not used for older events or invalid, placeholder, and future entries", () => {
  for (const record of [
    null, {...quote, updated_date: "2026-10-07T23:20:21Z"},
    {...quote, status_history: []},
    {...quote, status_history: [{changed_by: "latest@example.com", changed_at: "invalid"}]},
    {...quote, status_history: [{changed_by: "latest@example.com", changed_at: "2026-10-08T22:20:20Z"}]},
    {...quote, status_history: [{changed_by: "demo@example.invalid", changed_at: "2026-10-07T22:20:20Z"}]}
  ]) assert.equal(withQuoteAttribution(notice, record), notice);
});
