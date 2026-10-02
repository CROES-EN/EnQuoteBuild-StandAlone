const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { repositoryFor } = require("../../electron/repository.cjs");
const { createLargeTableStore } = require("../../electron/largeTableStore.cjs");

const quiet = { info() {}, warn() {}, error() {} };

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-large-tables-"));
  const repository = repositoryFor(path.join(root, "data"));
  // A brand-new data file needs two plain reads to finish its one-time first-run setup.
  await repository.list();
  await repository.list();
  const directory = path.join(root, "large-tables");
  const store = createLargeTableStore({ directory, repository, logger: quiet });
  return { root, repository, directory, store, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

const sampleTable = (rows = 3) => ({
  id: "care_subscriptions",
  reportType: "care_subscriptions",
  columns: ["Subscription Id", "Subscription Status"],
  rows: Array.from({ length: rows }, (_, i) => ({ "Subscription Id": String(i), "Subscription Status": "ACTIVE" })),
  sourceFileName: "care.csv"
});

test("saves to its own file, reads it back, and deletes it", async () => {
  const ctx = await setup();
  try {
    assert.equal(await ctx.store.get("care_subscriptions"), null);

    const saved = await ctx.store.save("care_subscriptions", sampleTable());
    assert.ok(saved.created_date && saved.updated_date);
    assert.deepEqual((await ctx.store.get("care_subscriptions")).rows, sampleTable().rows);
    JSON.parse(await fs.readFile(path.join(ctx.directory, "care_subscriptions.json"), "utf8"));

    // The main data file never receives it.
    assert.deepEqual(await ctx.repository.listCollection("supervisorReportTables"), []);

    await ctx.store.delete("care_subscriptions");
    assert.equal(await ctx.store.get("care_subscriptions"), null);
  } finally {
    await ctx.cleanup();
  }
});

test("a table still stored in the main data file is moved out on first read", async () => {
  const ctx = await setup();
  try {
    await ctx.repository.createCollectionRecord("supervisorReportTables", sampleTable(5));
    await ctx.repository.createCollectionRecord("supervisorReportTables", { id: "workload", reportType: "workload", columns: [], rows: [] });

    const table = await ctx.store.get("care_subscriptions");
    assert.equal(table.rows.length, 5);

    const remaining = (await ctx.repository.listCollection("supervisorReportTables")).map((record) => record.id);
    assert.deepEqual(remaining, ["workload"]);
    assert.equal((await ctx.store.get("care_subscriptions")).rows.length, 5);
  } finally {
    await ctx.cleanup();
  }
});

test("deleting also removes an un-migrated copy so it cannot come back", async () => {
  const ctx = await setup();
  try {
    await ctx.repository.createCollectionRecord("supervisorReportTables", sampleTable(2));
    await ctx.store.delete("care_subscriptions");
    assert.equal(await ctx.store.get("care_subscriptions"), null);
  } finally {
    await ctx.cleanup();
  }
});

test("only registered tables are accepted", async () => {
  const ctx = await setup();
  try {
    assert.throws(() => ctx.store.get("workload"), /Not a large report table/);
    assert.throws(() => ctx.store.save("../escape", sampleTable()), /Not a large report table/);
    assert.throws(() => ctx.store.delete("quotes"), /Not a large report table/);
  } finally {
    await ctx.cleanup();
  }
});

test("concurrent saves leave one valid, complete file", async () => {
  const ctx = await setup();
  try {
    await Promise.all([1, 2, 3, 4, 5].map((n) => ctx.store.save("care_subscriptions", sampleTable(n * 100))));
    const table = await ctx.store.get("care_subscriptions");
    assert.equal(table.rows.length, 500);
    const files = await fs.readdir(ctx.directory);
    assert.deepEqual(files, ["care_subscriptions.json"]);
  } finally {
    await ctx.cleanup();
  }
});

test("a corrupt file is set aside instead of being overwritten or crashing the read", async () => {
  const ctx = await setup();
  try {
    await fs.mkdir(ctx.directory, { recursive: true });
    await fs.writeFile(path.join(ctx.directory, "care_subscriptions.json"), "{ not json", "utf8");
    assert.equal(await ctx.store.get("care_subscriptions"), null);
    const files = await fs.readdir(ctx.directory);
    assert.ok(files.some((name) => name.includes(".corrupt-")));
  } finally {
    await ctx.cleanup();
  }
});
