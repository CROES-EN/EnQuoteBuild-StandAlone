const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { repositoryFor } = require("../../electron/repository.cjs");

async function withUserData(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-write-queue-test-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("Panel RMA stale-edit and duplicate-case guards run inside the atomic write queue", async () => {
  await withUserData(async directory => {
    const repository = repositoryFor(directory);
    await repository.list();
    const first = await repository.createCollectionRecord("rmas", {id:"rma-1",case_id:"123",updated_date:"2026-01-01T00:00:00.000Z"});
    await repository.createCollectionRecord("rmas", {id:"rma-2",case_id:"456"});
    const results = await Promise.allSettled([
      repository.updateCollectionRecord("rmas", first.id, {panel_model:"P400"}, {expectedUpdatedDate:first.updated_date}),
      repository.updateCollectionRecord("rmas", first.id, {panel_model:"P500"}, {expectedUpdatedDate:first.updated_date})
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.match(results[1].reason.message, /changed while you were editing/);
    await assert.rejects(repository.updateCollectionRecord("rmas", first.id, {case_id:"456"}), /already has/);
    assert.equal((await repository.listCollection("rmas")).find(record => record.id === first.id).panel_model, "P400");
  });
});

test("automatic drafts atomically preserve existing case drafts and ignore retired improper marks", async () => {
  await withUserData(async directory => {
    const repository = repositoryFor(directory);
    await repository.list();
    const results = await Promise.allSettled([
      repository.createCollectionRecord("autoDrafterGeneratedDrafts", {id:"draft-1",caseNumber:" CASE-1 ",draft:{edited:true}}),
      repository.createCollectionRecord("autoDrafterGeneratedDrafts", {id:"draft-2",caseNumber:"case-1",draft:{edited:false}})
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.match(results[1].reason.message, /already has a saved/);
    assert.equal((await repository.listCollection("autoDrafterGeneratedDrafts")).length, 1);
    assert.equal((await repository.listCollection("autoDrafterGeneratedDrafts"))[0].draft.edited, true);
    await repository.createCollectionRecord("supervisorReportTables", {id:"mark-2",kind:"quote_request_review",action:"mark",caseNumber:"case-2"});
    await repository.createCollectionRecord("autoDrafterGeneratedDrafts", {id:"draft-3",caseNumber:"case-2"});
    assert.equal((await repository.listCollection("autoDrafterGeneratedDrafts")).length, 2);
  });
});

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} deadlocked`)), 5000); })
  ]).finally(() => clearTimeout(timer));
}

// Data file as left behind by a Base44 snapshot import: valid, but without the one-time
// migration flag, so the next read() persists it via write().
async function writeFileWithoutMigrationFlag(directory) {
  await fs.writeFile(path.join(directory, "enquote-data-v1.json"), JSON.stringify({
    version: 1,
    quotes: [{ id: "quote-1", quote_number: "Q-1" }],
    meta: {}
  }), "utf8");
}

test("collection writes do not deadlock when read() needs to persist the migration flag", async () => {
  await withUserData(async (directory) => {
    await writeFileWithoutMigrationFlag(directory);
    const repository = repositoryFor(directory);

    await withTimeout(repository.createCollectionRecord("activities", { id: "activity-1" }), "createCollectionRecord");
    await withTimeout(repository.mutateCollection("activities", (rows) => [...rows, { id: "activity-2" }]), "mutateCollection");

    const activities = await withTimeout(repository.listCollection("activities"), "listCollection");
    assert.deepEqual(activities.map((row) => row.id), ["activity-1", "activity-2"]);
    assert.equal(await withTimeout(repository.list(), "list").then((quotes) => quotes.length), 1);
  });
});

test("concurrent collection writes stay serialized without losing records", async () => {
  await withUserData(async (directory) => {
    await writeFileWithoutMigrationFlag(directory);
    const repository = repositoryFor(directory);

    await withTimeout(Promise.all(
      Array.from({ length: 5 }, (_, index) => repository.createCollectionRecord("activities", { id: `activity-${index}` }))
    ), "concurrent createCollectionRecord");

    const activities = await repository.listCollection("activities");
    assert.equal(activities.length, 5);
  });
});

test("saved line items survive immediate submission and manual status changes", async () => {
  await withUserData(async directory => {
    await writeFileWithoutMigrationFlag(directory);
    const repository = repositoryFor(directory);
    const original = await repository.get("quote-1");
    const items = [{product_id:"new-part",name:"Added part",quantity:2,total:27}];
    await withTimeout(Promise.all([
      repository.update(original.id, {items,total:27}, original._rev || 1),
      repository.update(original.id, {status:"submitted"}),
      repository.createCollectionRecord("activities", {id:"submit-log"})
    ]), "save then submit");
    for (const status of ["approved","quote_sent_to_ho","draft_without_internal"]) {
      await repository.update(original.id, {status});
      assert.deepEqual((await repository.get(original.id)).items, items);
    }
    assert.deepEqual((await repositoryFor(directory).get(original.id)).items, items);
  });
});

test("acknowledging an older push keeps newer items and status pending, and inbound snapshots cannot erase them", async () => {
  await withUserData(async directory => {
    await writeFileWithoutMigrationFlag(directory);
    const repository = repositoryFor(directory);
    const quote = await repository.create({status:"draft",quote_number:"Q-pending",items:[]});
    const sent = (await repository.listPendingOutboundQuotes()).find(entry => entry.local_id === quote.id);
    const items = [{product_id:"added",quantity:1,total:10}];
    await repository.update(quote.id, {items,total:10}, quote._rev);
    await repository.update(quote.id, {status:"submitted"});
    await repository.markOutboundSynced([{local_id:quote.id,remote_id:"remote-pending",revision:sent.quote._rev}]);
    let pending = (await repository.listPendingOutboundQuotes()).find(entry => entry.local_id === quote.id);
    assert.equal(pending.kind, "update");
    assert.equal(pending.remote_id, "remote-pending");
    assert.deepEqual(pending.quote.items, items);
    assert.equal(pending.quote.status, "submitted");
    await repository.importData({version:1,quotes:[{id:"remote-pending",quote_number:"Q-pending",
      status:"draft",items:[],updated_date:"2099-01-01T00:00:00Z"}]});
    assert.deepEqual((await repository.get(quote.id)).items, items, "unacknowledged edits survive an inbound echo");
    assert.equal((await repository.get(quote.id)).status, "submitted");
    pending = (await repository.listPendingOutboundQuotes()).find(entry => entry.local_id === quote.id);
    await repository.markOutboundSynced([{local_id:quote.id,remote_id:"remote-pending",revision:pending.quote._rev}]);
    assert.equal((await repository.listPendingOutboundQuotes()).some(entry => entry.local_id === quote.id), false);
  });
});

test("snapshot import keeps the local migration flag", async () => {
  await withUserData(async (directory) => {
    await writeFileWithoutMigrationFlag(directory);
    const repository = repositoryFor(directory);
    await repository.list();

    await repository.importData({ version: 1, quotes: [{ id: "quote-2", quote_number: "Q-2" }] });

    const raw = JSON.parse(await fs.readFile(path.join(directory, "enquote-data-v1.json"), "utf8"));
    assert.equal(raw.meta.sharedPasswordMigrationCompleted, true);
  });
});

  test("quote updates survive simultaneous navigation writes and sync acknowledgements", async () => {
    await withUserData(async directory => {
      await writeFileWithoutMigrationFlag(directory);
      const repository = repositoryFor(directory);
      const quote = await repository.create({id:"demo-quote-save",quote_number:"Q-save",status:"draft",scope_of_work:"Before"});
      await withTimeout(Promise.all([
        repository.update(quote.id, {scope_of_work:"Saved changes"}, quote._rev),
        repository.createCollectionRecord("activities", {id:"navigation-activity"}),
        repository.markOutboundSynced([{local_id:quote.id,remote_id:"remote-save"}])
      ]), "save during navigation");
      const saved = await repository.get(quote.id);
      assert.equal(saved.scope_of_work, "Saved changes");
      assert.equal(saved.base44_id, "remote-save");
      assert.equal((await repository.listCollection("activities")).length, 1);
      const reopened = repositoryFor(directory);
      assert.equal((await reopened.get(quote.id)).scope_of_work, "Saved changes", "changes persist on disk after reopening");
    });
  });

  test("simultaneous updates check revisions atomically instead of silently replacing a confirmed save", async () => {
    await withUserData(async directory => {
      await writeFileWithoutMigrationFlag(directory);
      const repository = repositoryFor(directory);
      const quote = await repository.get("quote-1");
      const results = await withTimeout(Promise.allSettled([
        repository.update(quote.id, {scope_of_work:"First"}, quote._rev || 1),
        repository.update(quote.id, {scope_of_work:"Second"}, quote._rev || 1)
      ]), "concurrent quote edits");
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.match(results.find(result => result.status === "rejected").reason.message, /CONFLICT:/);
      assert.equal((await repository.get(quote.id)).scope_of_work, "First");
    });
  });
