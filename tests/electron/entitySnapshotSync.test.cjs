const assert = require("node:assert/strict");
const test = require("node:test");
const { importEntitySnapshot } = require("../../electron/entitySnapshotSync.cjs");

test("imports entity snapshots in one repository merge with mapped collections", async () => {
  let imported;
  const repository = {
    async importData(snapshot) {
      imported = snapshot;
    }
  };

  const count = await importEntitySnapshot(repository, [
    { entityType: "Quote", localId: "quote-1", record: { id: "quote-1", site_id: "site-1", quote_number: "Q-1" } },
    { entityType: "Product", localId: "product-1", record: { name: "Panel" } },
    { entityType: "QuoteActivity", localId: "activity-1", record: { action: "created" } },
    { entityType: "EmailDistribution", localId: "email-1", record: {} },
    { entityType: "UnknownType", localId: "unknown-1", record: {} },
    { entityType: "Quote", localId: "invalid-quote", record: { quote_number: "Q-2" } }
  ]);

  assert.equal(count, 3);
  assert.equal(imported.version, 1);
  assert.deepEqual(imported.quotes.map(({ id, base44_id }) => [id, base44_id]), [["quote-1", "quote-1"]]);
  assert.deepEqual(imported.products.map(({ id, base44_id }) => [id, base44_id]), [["product-1", "product-1"]]);
  assert.deepEqual(imported.activities.map(({ id, base44_id }) => [id, base44_id]), [["activity-1", "activity-1"]]);
});

test("does not write when no supported records are present", async () => {
  let called = false;
  const repository = {
    async importData() {
      called = true;
    }
  };

  const count = await importEntitySnapshot(repository, [
    { entityType: "Invitation", localId: "invite-1", record: {} }
  ]);

  assert.equal(count, 0);
  assert.equal(called, false);
});
