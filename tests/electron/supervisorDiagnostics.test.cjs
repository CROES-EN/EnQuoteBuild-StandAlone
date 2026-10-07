const assert = require("node:assert/strict");
const test = require("node:test");
const {createSupervisorSync} = require("../../electron/supervisorSync.cjs");

function createSync({records = [], fetchImpl} = {}) {
  return createSupervisorSync({
    workerUrl: "https://worker.example",
    repository: {listCollection: async name => name === "supervisorReportTables" ? records : []},
    pendingDeletesPath: "unused-supervisor-diagnostic-test-path.json",
    getIdentity: () => ({email: "test@example.com"}),
    getOutboundToken: () => "test-token",
    fetchImpl: fetchImpl || (async url => new Response(JSON.stringify(
      new URL(url).pathname.endsWith("/index") ? {ok: true, records: []} : {ok: false, error: "record rejected"}
    ), {status: new URL(url).pathname.endsWith("/index") ? 200 : 500})),
    logger: {warn() {}, info() {}}
  });
}

test("partial supervisor record failure is not reported as successful reconciliation", async () => {
  const sync = createSync({records: [{id: "report", rows: []}]});
  assert.equal(sync.getStatus().lastResult, null);
  const result = await sync.reconcile();
  assert.equal(result.ok, false);
  assert.equal(result.failedRecords, 1);
  assert.match(result.error, /could not sync/);
  assert.equal(sync.getStatus().lastResult.ok, false);
  assert.ok(sync.getStatus().lastCompletedAt);
  assert.equal(sync.getStatus().running, false);
});

test("oversized records are explicitly counted as local-only", async () => {
  const sync = createSync({records: [{id: "large", rows: [{value: "x".repeat(8_100_000)}]}]});
  const result = await sync.reconcile();
  assert.equal(result.ok, true);
  assert.equal(result.localOnlyRecords, 1);
  assert.equal(result.failedRecords, 0);
});

test("supervisor network failure persists as a diagnostic error", async () => {
  const sync = createSync({fetchImpl: async () => {throw new Error("offline");}});
  assert.equal((await sync.reconcile()).error, "offline");
  assert.equal(sync.getStatus().lastResult.error, "offline");
});
