const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");
const {Buffer} = require("node:buffer");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {recordToWorkbookRow} = require("./refundWorkbookSync.cjs");

const execFileAsync = promisify(execFile);
const source = process.env.ENQUOTE_EXCEL_TEST_SOURCE;
const enabled = process.platform === "win32" && Boolean(source);
const script = path.join(path.dirname(require.resolve("./refundWorkbook.cjs")), "refundWorkbook.ps1");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-excel-test-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}));
  const target = path.join(root, "tracker.xlsx");
  fs.copyFileSync(source, target);
  async function run(operation, rows, options = {}) {
    const payload = rows ? Buffer.from(JSON.stringify({rows, ...options})).toString("base64") : "";
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-Operation", operation, "-WorkbookPath", target, "-Payload", payload, "-SnapshotDirectory", root
    ], {timeout: 45_000, maxBuffer: 8 * 1024 * 1024});
    return JSON.parse(result.stdout.trim());
  }
  function assertClean() {
    assert.deepEqual(fs.readdirSync(root).filter((name) =>
      name.startsWith("enquote-refund-") || name.includes(".enquote-")), []);
  }
  return {root, target, run, assertClean};
}

test("real Excel snapshot reads and atomically publishes native rows and edits without duplicates", {skip: !enabled}, async (t) => {
  const {target, run, assertClean} = fixture(t);
  const original = fs.readFileSync(target);
  const initial = await run("read");
  assert.equal(initial.tableName, "Table2");
  assert.deepEqual(fs.readFileSync(target), original);
  const record = {
    externalResponseId: "enquote-excel-regression", submittedAt: "2026-10-09T17:00:00.000Z",
    customerName: "Disposable test", customerEmail: "customer@example.com", caseNumber: "TEST-1",
    refundChoice: "Full refund", cancellationTiming: "Immediately", servicesCompleted: "No",
    refundAmountRequested: 1200, status: "Submitted"
  };
  await run("write", [recordToWorkbookRow(record)]);
  await run("write", [{ID: record.externalResponseId, Status: "Under Review", "EnQuote Store Team Notes": "Updated"}]);
  const result = await run("read");
  const rows = result.rows.filter((row) => row.ID === record.externalResponseId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Status, "Under Review");
  assert.equal(rows[0]["Customer email address"], record.customerEmail);
  assert.equal(rows[0]["Refund amount (USD)"], 1200);
  assert.equal(rows[0]["EnQuote Store Team Notes"], "Updated");
  const beforeRejectedWrite = fs.readFileSync(target);
  await assert.rejects(run("write", [], {expectedHash: "stale-hash"}), /changed since it was read/);
  assert.deepEqual(fs.readFileSync(target), beforeRejectedWrite);
  const deleted = await run("write", [], {deleteIds: [record.externalResponseId], expectedHash: result.sourceHash});
  assert.equal(deleted.rows.some((row) => row.ID === record.externalResponseId), false);
  assert.equal(deleted.rows.length, initial.rows.length);
  assertClean();
});

test("failed Excel updates leave the shared source unchanged and remove snapshots", {skip: !enabled}, async (t) => {
  const {target, run, assertClean} = fixture(t);
  const original = fs.readFileSync(target);
  await assert.rejects(run("write", [{Status: "Submitted"}]), /missing its EnQuote response ID/);
  assert.deepEqual(fs.readFileSync(target), original);
  assertClean();
});

test("publication rejects changes arriving after the snapshot without overwriting them", {skip: !enabled}, async (t) => {
  const {root, target, run, assertClean} = fixture(t);
  let changedBytes;
  let mutationError;
  const timer = setInterval(() => {
    if (changedBytes || !fs.readdirSync(root).some((name) => name.startsWith("enquote-refund-"))) return;
    try {
      const newer = Buffer.concat([fs.readFileSync(target), Buffer.from("newer-edit")]);
      fs.writeFileSync(target, newer);
      changedBytes = newer;
      clearInterval(timer);
    } catch (error) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code)) mutationError = error;
    }
  }, 10);
  t.after(() => clearInterval(timer));
  await assert.rejects(run("write", [{ID: "enquote-concurrent-test", Status: "Submitted"}]), /changed while Excel was processing/);
  assert.equal(mutationError, undefined);
  assert.ok(changedBytes, "a newer source edit arrived after the snapshot");
  assert.deepEqual(fs.readFileSync(target), changedBytes);
  assertClean();
});
