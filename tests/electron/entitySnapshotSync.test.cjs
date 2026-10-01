const assert = require("node:assert/strict");
const test = require("node:test");
const { importEntitySnapshot } = require("../../electron/entitySnapshotSync.cjs");

test("imports entity snapshots in one repository merge with mapped collections", async () => {
  let imported;
  const repository = {
    async list() {
      return [];
    },
    async importData(snapshot) {
      imported = snapshot;
      return snapshot.quotes;
    }
  };

  const result = await importEntitySnapshot(repository, [
    { entityType: "Quote", localId: "quote-1", record: { id: "quote-1", site_id: "site-1", quote_number: "Q-1" } },
    { entityType: "Product", localId: "product-1", record: { name: "Panel" } },
    { entityType: "QuoteActivity", localId: "activity-1", record: { action: "created" } },
    { entityType: "EmailDistribution", localId: "email-1", record: {} },
    { entityType: "UnknownType", localId: "unknown-1", record: {} },
    { entityType: "Quote", localId: "invalid-quote", record: { quote_number: "Q-2" } }
  ]);

  assert.deepEqual(result, {
    importedRecordCount: 3,
    quoteSnapshotCount: 1,
    quoteAddedCount: 1,
    quoteUpdatedCount: 0
  });
  assert.equal(imported.version, 1);
  assert.deepEqual(imported.quotes.map(({ id, base44_id }) => [id, base44_id]), [["quote-1", "quote-1"]]);
  assert.deepEqual(imported.products.map(({ id, base44_id }) => [id, base44_id]), [["product-1", "product-1"]]);
  assert.deepEqual(imported.activities.map(({ id, base44_id }) => [id, base44_id]), [["activity-1", "activity-1"]]);
});

test("reports quote updates accepted by the repository merge", async () => {
  const existing = { id: "quote-1", base44_id: "quote-1", _rev: 2 };
  const repository = {
    async list() {
      return [existing];
    },
    async importData(snapshot) {
      return snapshot.quotes.map((quote) => ({ ...quote, _rev: existing._rev + 1 }));
    }
  };

  const result = await importEntitySnapshot(repository, [
    { entityType: "Quote", localId: "quote-1", record: { site_id: "site-1", quote_number: "Q-1" } }
  ]);

  assert.deepEqual(result, {
    importedRecordCount: 1,
    quoteSnapshotCount: 1,
    quoteAddedCount: 0,
    quoteUpdatedCount: 1
  });
});

test("imports a quote with no quote number when its site and case identifiers are present", async () => {
  let imported;
  const quote = {
    id: "quote-with-case-only",
    site_id: "195774",
    case_number: "20395864",
    quote_number: null,
    is_current_version: true
  };
  const repository = {
    async list() {
      return [];
    },
    async importData(snapshot) {
      imported = snapshot;
      return snapshot.quotes;
    }
  };

  const result = await importEntitySnapshot(repository, [
    { entityType: "Quote", localId: quote.id, record: quote }
  ]);

  assert.equal(result.quoteSnapshotCount, 1);
  assert.equal(result.quoteAddedCount, 1);
  assert.deepEqual(imported.quotes, [{ ...quote, base44_id: quote.id }]);
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

  assert.deepEqual(count, {
    importedRecordCount: 0,
    quoteSnapshotCount: 0,
    quoteAddedCount: 0,
    quoteUpdatedCount: 0
  });
  assert.equal(called, false);
});
