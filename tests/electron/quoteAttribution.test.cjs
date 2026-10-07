const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyVerifiedQuoteCreator,
  applyVerifiedQuoteUpdate,
  requireVerifiedEmail,
  recordedUpdater,
  parseRecordTimestamp
} = require("../../electron/quoteAttribution.cjs");

test("stamps newly created quotes with the verified Cloudflare user", () => {
  const attributed = applyVerifiedQuoteCreator({
    site_id: "test-site",
    status_history: [{ status: "submitted", changed_by: "stale@example.com" }]
  }, { email: " Shane.Mosley@EnphaseEnergy.com " });

  assert.equal(attributed.owner_email, "shane.mosley@enphaseenergy.com");
  assert.equal(attributed.status_history[0].changed_by, "shane.mosley@enphaseenergy.com");
});

test("notification attribution uses the updater, not an unrelated historic status author", () => {
  const quote = {
    updated_date: "2026-10-07T16:50:15.268397",
    status_history: [{changed_by: "demo.user@example.invalid", changed_at: "2026-09-11T19:05:38.398Z"}]
  };
  assert.equal(recordedUpdater(quote), null);
  assert.equal(recordedUpdater({...quote, last_updated_by: " REAL@Example.com "}), "real@example.com");
  assert.equal(recordedUpdater({...quote, last_updated_by: "demo.user@example.invalid"}), null);
  assert.equal(recordedUpdater({
    ...quote,
    status_history: [{changed_by: "author@example.com", changed_at: "2026-10-07T16:50:15.268Z"}]
  }), "author@example.com");
  assert.equal(recordedUpdater({...quote, status_history: [{changed_by: "author@example.com", changed_at: "invalid"}]}), null);
});

test("Base44 UTC timestamps and explicit-offset timestamps compare as the same event", () => {
  assert.equal(parseRecordTimestamp("2026-10-07T16:51:00.268397"), parseRecordTimestamp("2026-10-07T16:51:00.268Z"));
  assert.equal(parseRecordTimestamp("2026-10-07T10:51:00.268-06:00"), parseRecordTimestamp("2026-10-07T16:51:00.268Z"));
  assert.ok(Number.isNaN(parseRecordTimestamp("invalid")));
});

test("attributes new status history entries and quote updates to the verified user", () => {
  const current = {
    status_history: [{ status: "draft", changed_by: "creator@example.com" }]
  };
  const changes = {
    status: "submitted",
    status_history: [
      current.status_history[0],
      { status: "submitted", changed_by: "stale@example.com" }
    ]
  };

  const attributed = applyVerifiedQuoteUpdate(current, changes, { email: "shane@enphaseenergy.com" });

  assert.equal(attributed.last_updated_by, "shane@enphaseenergy.com");
  assert.equal(attributed.status_history[0].changed_by, "creator@example.com");
  assert.equal(attributed.status_history[1].changed_by, "shane@enphaseenergy.com");
});

test("does not accept quote writes without a verified identity", () => {
  assert.throws(() => requireVerifiedEmail(null), /Verified Cloudflare identity is unavailable/);
  assert.throws(() => requireVerifiedEmail({email: "demo.user@example.invalid"}), /Verified Cloudflare identity is unavailable/);
  assert.throws(() => applyVerifiedQuoteCreator({ site_id: "test-site" }, null), /Verified Cloudflare identity is unavailable/);
});

test("imported quote notifications preserve the update time and verified edit attribution", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const {repositoryFor} = require("../../electron/repository.cjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-notification-attribution-"));
  try {
    const repository = repositoryFor(directory);
    const original = {
      id: "test-q", quote_number: "Q-TEST", updated_date: "2026-10-07T15:00:00Z",
      status_history: [{changed_by: "demo.user@example.invalid", changed_at: "2026-09-11T19:05:38.398Z"}]
    };
    await repository.importData({version: 1, quotes: [original]});
    const changes = applyVerifiedQuoteUpdate(original, {total: 100}, {email: "signed.in@example.com"});
    const update = {...original, ...changes, updated_date: "2026-10-07T16:51:00Z"};
    await repository.importData({version: 1, quotes: [update]});
    const notifications = await repository.listCollection("appNotifications");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].changedBy, "signed.in@example.com");
    assert.equal(notifications[0].occurredAt, update.updated_date);
    await repository.importData({version: 1, quotes: [update]});
    assert.equal((await repository.listCollection("appNotifications")).length, 1);
    await repository.importData({version: 1, quotes: [{...update, updated_date: "2026-10-07T16:51:00.000000"}]});
    assert.equal((await repository.listCollection("appNotifications")).length, 1);
    for (let i = 0; i < 35; i++) {
      await repository.importData({version: 1, quotes: [{
        ...update, updated_date: `2026-10-07T17:00:${String(i).padStart(2, "0")}Z`,
        base44_synced_at: `2026-10-07T17:00:${String(i).padStart(2, "0")}Z`,
        _rev: i + 10
      }]});
    }
    assert.equal((await repository.listCollection("appNotifications")).length, 1);
    assert.equal((await repository.list())[0].updated_date, "2026-10-07T17:00:34Z");
    await repository.importData({version: 1, quotes: [{...update, total: 200, updated_date: "2026-10-07T18:00:00Z"}]});
    const latest = await repository.listCollection("appNotifications");
    assert.equal(latest.length, 2);
    assert.notEqual(latest[0].eventId, latest[1].eventId);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
