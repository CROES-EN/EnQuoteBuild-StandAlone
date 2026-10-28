const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { repositoryFor } = require("../../electron/repository.cjs");
const { importEntitySnapshot } = require("../../electron/entitySnapshotSync.cjs");

async function withRepository(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-entity-queue-test-"));
  try {
    const repository = repositoryFor(directory);
    await repository.list();
    await run(repository, directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const pending = async repository => (await repository.listPendingOutboundEntities())
  .map(({ collection, action, local_id, remote_id }) => ({ collection, action, local_id, remote_id }));

test("desktop edits to shared collections queue one coalesced entry and record the Base44 id", async () => {
  await withRepository(async repository => {
    const flag = await repository.createCollectionRecord("siteFlags", { site_id: "S-1", level: 2 });
    await repository.updateCollectionRecord("siteFlags", flag.id, { level: 3 });
    await repository.createCollectionRecord("appNotifications", { type: "x" });
    const entries = await repository.listPendingOutboundEntities();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "create");
    assert.equal(entries[0].record.level, 3);

    await repository.markOutboundEntitiesSynced([{ entry_id: entries[0].id, revision: entries[0].revision, remote_id: "b44-flag" }]);
    assert.deepEqual(await pending(repository), []);
    const stored = (await repository.listCollection("siteFlags")).find(item => item.id === flag.id);
    assert.equal(stored.base44_id, "b44-flag");

    await repository.updateCollectionRecord("siteFlags", flag.id, { level: 1 });
    assert.deepEqual(await pending(repository), [{ collection: "siteFlags", action: "update", local_id: flag.id, remote_id: "b44-flag" }]);
    await repository.deleteCollectionRecord("siteFlags", flag.id);
    assert.deepEqual(await pending(repository), [{ collection: "siteFlags", action: "delete", local_id: flag.id, remote_id: "b44-flag" }]);
  });
});

test("deleting a never-uploaded record drops it, and an edit during an in-flight push stays pending", async () => {
  await withRepository(async repository => {
    const draft = await repository.createCollectionRecord("rmas", { case_id: "1" });
    await repository.deleteCollectionRecord("rmas", draft.id);
    assert.deepEqual(await pending(repository), []);

    const rma = await repository.createCollectionRecord("rmas", { case_id: "2" });
    const [inFlight] = await repository.listPendingOutboundEntities();
    await repository.updateCollectionRecord("rmas", rma.id, { panel_model: "P400" });
    await repository.markOutboundEntitiesSynced([{ entry_id: inFlight.id, revision: inFlight.revision, remote_id: "b44-rma" }]);
    assert.deepEqual(await pending(repository), [{ collection: "rmas", action: "update", local_id: rma.id, remote_id: "b44-rma" }]);

    const other = await repository.createCollectionRecord("rmas", { case_id: "3" });
    const [secondInFlight] = (await repository.listPendingOutboundEntities()).filter(entry => entry.local_id === other.id);
    await repository.deleteCollectionRecord("rmas", other.id);
    await repository.markOutboundEntitiesSynced([{ entry_id: secondInFlight.id, revision: secondInFlight.revision,
      action: "create", collection: "rmas", local_id: other.id, remote_id: "b44-orphan" }]);
    assert.ok((await pending(repository)).some(entry => entry.action === "delete" && entry.remote_id === "b44-orphan"));
  });
});

test("failed pushes stay queued with the error recorded", async () => {
  await withRepository(async repository => {
    await repository.createCollectionRecord("pvManufacturers", { name: "Acme" });
    const [entry] = await repository.listPendingOutboundEntities();
    await repository.markOutboundEntitiesSynced([{ entry_id: entry.id, error: "HTTP 500" }]);
    const [again] = await repository.listPendingOutboundEntities();
    assert.equal(again.id, entry.id);
    assert.equal(again.attempts, 1);
    assert.equal(again.last_error, "HTTP 500");
  });
});

test("records created before the queue existed are backfilled, and newer local edits survive imports and queue an upload", async () => {
  await withRepository(async (repository, directory) => {
    const file = path.join(directory, "enquote-data-v1.json");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    data.siteFlags = [{ id: "demo-siteFlags-1-abcd", site_id: "S-9" }];
    data.reviews = [{ id: "rev-1", base44_id: "rev-1", note: "local newer", updated_date: "2026-10-02T00:00:00.000Z" }];
    data.outboundDismissalQueue = [{ local_id: "dismiss-1", quote_id: "q", status: "pending" }];
    await fs.writeFile(file, JSON.stringify(data));

    await repository.importData({ version: 1, quotes: [], products: [],
      reviews: [{ id: "rev-1", note: "server older", updated_date: "2026-10-01T00:00:00.000Z" }] });
    const reviews = await repository.listCollection("reviews");
    assert.equal(reviews[0].note, "local newer");
    const entries = await pending(repository);
    assert.deepEqual(entries.sort((a, b) => a.collection.localeCompare(b.collection)), [
      { collection: "reviews", action: "update", local_id: "rev-1", remote_id: "rev-1" },
      { collection: "siteFlags", action: "create", local_id: "demo-siteFlags-1-abcd", remote_id: null }
    ]);
    assert.equal((await repository.listPendingOutboundDismissals()).length, 1);
  });
});

test("server tombstones remove local records instead of creating blank ones", async () => {
  await withRepository(async repository => {
    await repository.importData({ version: 1, quotes: [], products: [{ id: "p-1", name: "Panel" }],
      siteFlags: [{ id: "flag-1", site_id: "S-1", level: 2 }, { id: "flag-2", site_id: "S-2" }] });
    const result = await importEntitySnapshot(repository, [
      { entityType: "SiteFlag", localId: "flag-1", action: "delete", record: {} },
      { entityType: "Product", localId: "p-1", action: "delete", record: {} }
    ]);
    assert.equal(result.importedRecordCount, 2);
    assert.deepEqual((await repository.listCollection("siteFlags")).map(item => item.id), ["flag-2"]);
    assert.equal((await repository.listProducts()).some(item => item.id === "p-1"), false);
  });
});
