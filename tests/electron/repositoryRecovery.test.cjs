const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { repositoryFor } = require("../../electron/repository.cjs");

async function withUserData(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-repository-test-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("backs up and migrates a version-mismatched local file without losing local data", async () => {
  await withUserData(async (directory) => {
    const dataPath = path.join(directory, "enquote-data-v1.json");
    const original = {
      version: 42,
      quotes: [{ id: "quote-local", quote_number: "Q-LOCAL" }],
      userCredentials: { "person@example.com": { passwordHash: "local-hash" } },
      activities: [{ id: "activity-local" }],
      outboundQueue: [{ local_id: "quote-pending" }]
    };
    await fs.writeFile(dataPath, JSON.stringify(original), "utf8");

    const repository = repositoryFor(directory);
    assert.deepEqual(await repository.list(), original.quotes);
    const imported = await repository.importData({
      version: 1,
      quotes: [{ id: "quote-cloud", quote_number: "Q-CLOUD" }]
    });

    assert.equal(imported.length, 2);
    const recovered = await repository.exportData();
    assert.equal(recovered.version, 1);
    assert.deepEqual(recovered.userCredentials, original.userCredentials);
    assert.deepEqual(recovered.activities, original.activities);
    assert.deepEqual(recovered.outboundQueue, original.outboundQueue);

    const backups = await fs.readdir(path.join(directory, "Backups"));
    const incompatibleBackup = backups.find((name) => name.startsWith("enquote-data-v1.json.incompatible-"));
    assert.ok(incompatibleBackup);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "Backups", incompatibleBackup), "utf8")), original);
  });
});

test("recovers entity-style snapshots and preserves their supported records", async () => {
  await withUserData(async (directory) => {
    const dataPath = path.join(directory, "enquote-data-v1.json");
    await fs.writeFile(dataPath, JSON.stringify({
      version: 0,
      entities: {
        Quote: [{ id: "quote-entity", quote_number: "Q-ENTITY" }],
        Product: [{ id: "product-entity", name: "Panel" }],
        QuoteActivity: [{ id: "activity-entity" }]
      }
    }), "utf8");

    const repository = repositoryFor(directory);
    assert.deepEqual((await repository.list()).map(({ id }) => id), ["quote-entity"]);
    const recovered = await repository.exportData();
    assert.deepEqual(recovered.products.map(({ id }) => id), ["product-entity"]);
    assert.deepEqual(recovered.activities.map(({ id }) => id), ["activity-entity"]);
  });
});

test("preserves malformed JSON before initializing a usable local file", async () => {
  await withUserData(async (directory) => {
    const dataPath = path.join(directory, "enquote-data-v1.json");
    const malformed = "{ not valid JSON";
    await fs.writeFile(dataPath, malformed, "utf8");

    const repository = repositoryFor(directory);
    assert.deepEqual(await repository.list(), []);
    const recovered = await repository.exportData();
    assert.equal(recovered.version, 1);
    assert.deepEqual(recovered.quotes, []);

    const backups = await fs.readdir(path.join(directory, "Backups"));
    const incompatibleBackup = backups.find((name) => name.startsWith("enquote-data-v1.json.incompatible-"));
    assert.ok(incompatibleBackup);
    assert.equal(await fs.readFile(path.join(directory, "Backups", incompatibleBackup), "utf8"), malformed);
  });
});
