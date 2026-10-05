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
