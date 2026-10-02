const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { repositoryFor } = require("../../electron/repository.cjs");
const { createSupervisorSync } = require("../../electron/supervisorSync.cjs");

const workerDir = path.resolve(__dirname, "../../enquote-sync-worker");
const email = "manager@example.com";
const token = "e2e-token";
const quietLogger = { info() {}, warn() {}, error() {} };

// Wires real desktop sync clients to the real Worker handlers over a real SQLite-backed D1,
// so "two managers' machines" exercise the exact production request/response contract.
async function createCluster() {
  const { createSupervisorD1 } = await import(pathToFileURL(path.join(workerDir, "test-helpers/d1Shim.js")));
  const worker = await import(pathToFileURL(path.join(workerDir, "src/supervisor.js")));
  const env = { OUTBOUND_TOKEN: token, ALLOWED_EMAILS_LIST: email, DB: createSupervisorD1() };
  const routes = {
    "GET /api/supervisor/index": worker.handleSupervisorIndex,
    "GET /api/supervisor/record": worker.handleSupervisorRecord,
    "POST /api/supervisor/upsert": worker.handleSupervisorUpsert,
    "POST /api/supervisor/delete": worker.handleSupervisorDelete
  };
  const fetchImpl = async (url, init) => {
    const handler = routes[`${init.method} ${new URL(url).pathname}`];
    return handler(new Request(url, init), env);
  };
  const directories = [];

  async function addMachine({ failNetwork = false } = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-supervisor-sync-"));
    directories.push(directory);
    const repository = repositoryFor(directory);
    // A brand-new data file needs two plain reads to finish its one-time first-run setup;
    // doing that setup from inside a write would otherwise stall the write queue.
    await repository.list();
    await repository.list();
    let applied = 0;
    const machine = { repository, directory, offline: failNetwork, appliedNotifications: () => applied };
    machine.sync = createSupervisorSync({
      workerUrl: "https://worker.example",
      repository,
      pendingDeletesPath: path.join(directory, "pending-deletes.json"),
      getIdentity: () => ({ email }),
      getOutboundToken: () => token,
      onRemoteApplied: () => { applied += 1; },
      fetchImpl: async (url, init) => {
        if (machine.offline) throw new Error("offline");
        return fetchImpl(url, init);
      },
      logger: quietLogger
    });
    return machine;
  }

  return { addMachine, cleanup: () => Promise.all(directories.map((d) => fs.rm(d, { recursive: true, force: true }))) };
}

const save = async (machine, collection, record) => {
  const created = await machine.repository.createCollectionRecord(collection, record);
  await machine.sync.recordSaved(collection, created);
  return created;
};

test("an import on one machine appears on another, including large multi-chunk tables", async () => {
  const cluster = await createCluster();
  try {
    const a = await cluster.addMachine();
    const b = await cluster.addMachine();
    const rows = Array.from({ length: 3000 }, (_, i) => ({ Case: `C${i}`, Subject: "é".repeat(100) }));
    await save(a, "supervisorReportTables", { id: "workload", reportType: "workload", columns: ["Case", "Subject"], rows });
    await save(a, "supervisorDailyMetrics", { id: "2026-10-01", date: "2026-10-01", calls: 42 });

    await b.sync.reconcile();
    const tables = await b.repository.listCollection("supervisorReportTables");
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].rows, rows);
    assert.equal((await b.repository.listCollection("supervisorDailyMetrics"))[0].calls, 42);
    assert.equal(b.appliedNotifications(), 1);

    // Already identical - a second pass changes nothing and does not re-notify.
    await b.sync.reconcile();
    assert.equal(b.appliedNotifications(), 1);
  } finally {
    await cluster.cleanup();
  }
});

test("a re-import on one machine replaces the data everywhere, and Clear Data propagates", async () => {
  const cluster = await createCluster();
  try {
    const a = await cluster.addMachine();
    const b = await cluster.addMachine();
    await save(a, "supervisorReportTables", { id: "escalations", reportType: "escalations", rows: [{ n: 1 }, { n: 2 }] });
    await b.sync.reconcile();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await b.repository.updateCollectionRecord("supervisorReportTables", "escalations", { rows: [{ n: 3 }] });
    await b.sync.recordSaved("supervisorReportTables", updated);
    await a.sync.reconcile();
    assert.deepEqual((await a.repository.listCollection("supervisorReportTables"))[0].rows, [{ n: 3 }]);

    await a.repository.deleteCollectionRecord("supervisorReportTables", "escalations");
    await a.sync.recordDeleted("supervisorReportTables", "escalations");
    await b.sync.reconcile();
    assert.deepEqual(await b.repository.listCollection("supervisorReportTables"), []);
    // The deletion must not be resurrected by a later sync from either side.
    await a.sync.reconcile();
    assert.deepEqual(await a.repository.listCollection("supervisorReportTables"), []);
  } finally {
    await cluster.cleanup();
  }
});

test("a deletion made while offline is kept and delivered later instead of being undone", async () => {
  const cluster = await createCluster();
  try {
    const a = await cluster.addMachine();
    const b = await cluster.addMachine();
    await save(a, "supervisorDailyMetrics", { id: "2026-10-01", date: "2026-10-01", calls: 1 });
    await b.sync.reconcile();

    a.offline = true;
    await a.repository.deleteCollectionRecord("supervisorDailyMetrics", "2026-10-01");
    await a.sync.recordDeleted("supervisorDailyMetrics", "2026-10-01");
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(a.directory, "pending-deletes.json"), "utf8"))), ["supervisorDailyMetrics/2026-10-01"]);

    a.offline = false;
    await a.sync.reconcile();
    assert.deepEqual(await a.repository.listCollection("supervisorDailyMetrics"), []);
    await b.sync.reconcile();
    assert.deepEqual(await b.repository.listCollection("supervisorDailyMetrics"), []);
  } finally {
    await cluster.cleanup();
  }
});

test("the most recent save wins when two machines hold different copies", async () => {
  const cluster = await createCluster();
  try {
    const a = await cluster.addMachine();
    const b = await cluster.addMachine();
    await save(a, "supervisorReportTables", { id: "audits", reportType: "audits", rows: [{ v: "old" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // b holds its own, newer copy that predates sync (never pushed).
    await b.repository.createCollectionRecord("supervisorReportTables", { id: "audits", reportType: "audits", rows: [{ v: "newest" }] });

    await b.sync.reconcile();
    await a.sync.reconcile();
    const seenByA = (await a.repository.listCollection("supervisorReportTables")).filter((r) => r.id === "audits");
    const seenByB = (await b.repository.listCollection("supervisorReportTables")).filter((r) => r.id === "audits");
    assert.equal(seenByA.length, 1);
    assert.deepEqual(seenByA[0].rows, [{ v: "newest" }]);
    assert.deepEqual(seenByB[0].rows, [{ v: "newest" }]);
  } finally {
    await cluster.cleanup();
  }
});

test("applyRemoteCollectionRecord refuses to clobber a fresher local record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "enquote-supervisor-apply-"));
  try {
    const repository = repositoryFor(directory);
    await repository.list();
    await repository.list();
    const local = await repository.createCollectionRecord("supervisorReportTables", { id: "t", rows: ["local"] });
    const result = await repository.applyRemoteCollectionRecord("supervisorReportTables", "t", { id: "t", rows: ["remote"] }, "2000-01-01T00:00:00.000Z");
    assert.deepEqual(result, { applied: false });
    assert.deepEqual((await repository.listCollection("supervisorReportTables"))[0].rows, ["local"]);
    assert.equal(local.updated_date > "2000", true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
