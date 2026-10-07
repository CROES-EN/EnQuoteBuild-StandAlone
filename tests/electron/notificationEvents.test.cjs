const test = require("node:test");
const assert = require("node:assert/strict");
const {hasNotificationChange, notificationEventId, restoreNotificationAttribution} = require("../../electron/notificationEvents.cjs");

test("old notices recover recorded attribution only from the matching update event", () => {
  const notice = {type: "quote_updated", occurredAt: "2026-10-07T17:00:00.000Z", changedBy: null};
  const record = {updated_date: "2026-10-07T17:00:00.000000", last_updated_by: "editor@example.com"};
  assert.equal(restoreNotificationAttribution(notice, record).changedBy, "editor@example.com");
  assert.equal(restoreNotificationAttribution(notice, {...record, updated_date: "2026-10-07T18:00:00Z"}).changedBy, null);
  assert.equal(restoreNotificationAttribution({...notice, changedBy: "original@example.com"}, record).changedBy, "original@example.com");
  assert.equal(restoreNotificationAttribution(notice, null).changedBy, null);
});

test("content comparison ignores transport metadata and object ordering, not real edits", () => {
  const original = {id: "local", total: 100, items: [{name: "panel", count: 1}]};
  const synced = {
    items: [{count: 1, name: "panel"}], total: 100, id: "remote",
    base44_id: "remote", local_quote_id: "local", base44_synced_at: "later",
    _rev: 10, updated_date: "2026-10-07T17:00:00Z", last_updated_by: "user@example.com"
  };
  assert.equal(hasNotificationChange(original, synced), false);
  assert.equal(hasNotificationChange(original, {...synced, total: 200}), true);
  assert.equal(hasNotificationChange(original, {...synced, items: [{name: "panel", count: 2}]}), true);
  assert.equal(hasNotificationChange(original, {...synced, status: "scheduled"}), true);
});

test("event IDs are stable across local/remote identities and equivalent UTC timestamps", () => {
  const local = {id: "local", base44_id: "remote", total: 100, updated_date: "2026-10-07T17:00:00Z"};
  const remote = {id: "remote", total: 100, updated_date: "2026-10-07T17:00:00.000000"};
  assert.equal(notificationEventId("quote_updated", local), notificationEventId("quote_updated", remote));
  assert.notEqual(notificationEventId("quote_updated", local), notificationEventId("quote_updated", {...remote, total: 200}));
});
