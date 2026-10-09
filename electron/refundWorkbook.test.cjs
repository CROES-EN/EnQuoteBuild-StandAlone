const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");
const test = require("node:test");
const { createRefundWorkbook } = require("./refundWorkbook.cjs");

const WORKBOOK_NAME = "EnQuote_Care_Refund_Tracker.xlsx";

test("workbook coordinator syncs updates and lets processors resolve field conflicts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-refund-sync-"));
  const oneDrive = path.join(root, "OneDrive");
  const storageDir = path.join(root, "app-data");
  fs.mkdirSync(oneDrive, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  const folder = path.join(oneDrive, "Care - Cancel requests");
  fs.mkdirSync(folder);
  const workbookPath = path.join(folder, WORKBOOK_NAME);
  fs.writeFileSync(workbookPath, "");
  fs.writeFileSync(path.join(storageDir, "refund-workbook.json"), JSON.stringify({ path: workbookPath }));
  const previousOneDrive = process.env.OneDriveCommercial;
  process.env.OneDriveCommercial = oneDrive;

  const row = {
    ID: "forms-301",
    "Start time": "2026-10-08T15:00:00.000Z",
    "Completion time": "2026-10-08T15:00:00.000Z",
    "Requester Email": "alex@example.com",
    "Requester Name": "Alex Requestor",
    "Customer name": "Customer One",
    "Subscription ID": "SUB-1",
    "Site ID": "SITE-1",
    "Refund amount (USD)": 120.5,
    "Primary reason for the cancel and/or refund request": "Duplicate payment",
    "Detailed explanation of the refund request": "Additional details",
    Status: "Under Review"
  };
  const request = {
    id: "internal-301",
    externalResponseId: "forms-301",
    submittedAt: "2026-10-08T15:00:00.000Z",
    requestorName: "Alex Requestor",
    requestorDepartment: "Customer Care",
    requestorEmail: "alex@example.com",
    subscriptionId: "SUB-1",
    siteId: "SITE-1",
    customerName: "Customer One",
    refundAmountRequested: 120.5,
    refundReason: "Duplicate payment",
    siteVisitCompleted: true,
    refundType: "Partial Refund",
    leadershipApprovalRequired: false,
    leadershipApprovalJustification: null,
    additionalNotes: "Additional details",
    status: "New",
    storeTeamNotes: "",
    escalationNotes: "",
    refundProcessedDate: null,
    processorName: null,
    leadershipApprover: null,
    approvalDate: null,
    managerApproved: null,
    missingEnQuoteFields: [],
    lastUpdatedAt: "2026-10-08T15:00:00.000Z"
  };
  const baseline = Object.fromEntries([
    "requestorName", "requestorDepartment", "requestorEmail", "subscriptionId", "siteId",
    "customerName", "refundAmountRequested", "refundReason", "siteVisitCompleted", "refundType",
    "leadershipApprovalRequired", "leadershipApprovalJustification", "additionalNotes", "status",
    "storeTeamNotes", "escalationNotes", "refundProcessedDate", "processorName",
    "leadershipApprover", "approvalDate", "managerApproved"
  ].map((field) => [field, request[field] ?? null]));
  fs.writeFileSync(path.join(storageDir, "refund-workbook-sync.json"), JSON.stringify({
    baseline: {"forms-301": baseline},
    conflicts: [],
    invalidRows: []
  }));

  const rows = [row];
  const records = [request];
  const tombstones = [];
  const runWorkbook = async (operation, _path, payload) => {
    if (operation === "read") {
      return { ok: true, tableName: "Table2", headers: Object.keys(rows[0] || {ID: null}), rows: rows.map((item) => ({ ...item })) };
    }
    for (const id of payload.deleteIds || []) {
      const index = rows.findIndex((item) => String(item.ID) === id);
      if (index >= 0) rows.splice(index, 1);
    }
    for (const incoming of payload.rows) {
      const index = rows.findIndex((item) => String(item.ID) === String(incoming.ID));
      if (index < 0) rows.push({ ...incoming });
      else rows[index] = { ...rows[index], ...incoming };
    }
    return { ok: true, tableName: "Table2", headers: ["ID"], rows: rows.map((item) => ({ ...item })) };
  };
  const client = {
    async get() {
      return { ok: true, requests: records.map((item) => ({ ...item })), deletedExternalResponseIds: tombstones };
    },
    async post(_route, payload) {
      let updated = 0;
      const conflicts = [];
      for (const update of payload.updates) {
        const current = records.find((item) => item.externalResponseId === update.externalResponseId);
        if (!current || current.lastUpdatedAt !== update.expectedUpdatedAt) {
          conflicts.push({ externalResponseId: update.externalResponseId, reason: "record_changed" });
          continue;
        }
        Object.assign(current, update.changes);
        current.lastUpdatedAt = new Date(Date.parse(current.lastUpdatedAt) + 1000).toISOString();
        updated += 1;
      }
      for (const incoming of payload.imports) {
        if (!records.some((item) => item.externalResponseId === incoming.externalResponseId)) {
          records.push({ ...incoming, id: `internal-${records.length + 1}`, lastUpdatedAt: new Date().toISOString() });
        }
      }
      for (const deletion of payload.deletions || []) {
        const index = records.findIndex((item) => item.externalResponseId === deletion.externalResponseId);
        if (index >= 0) {
          tombstones.push(deletion.externalResponseId);
          records.splice(index, 1);
        }
      }
      return { ok: true, updated, imported: payload.imports.length, deleted: (payload.deletions || []).length, conflicts };
    }
  };
  let oneDriveEmail = "alex@example.com";
  const workbook = createRefundWorkbook({
    storageDir,
    getEmail: () => "alex@example.com",
    getOneDriveEmail: async () => oneDriveEmail,
    client,
    runWorkbook
  });

  try {
    const firstSync = await workbook.sync();
    assert.equal(firstSync.updated, 1);
    assert.equal(records[0].status, "Under Review");

    rows[0].Status = "Submitted";
    rows[0]["EnQuote Store Team Notes"] = "Workbook note";
    records[0].status = "Approved";
    records[0].lastUpdatedAt = new Date(Date.parse(records[0].lastUpdatedAt) + 1000).toISOString();
    const conflictedSync = await workbook.sync();
    assert.equal(conflictedSync.conflicts.length, 1);
    assert.equal(conflictedSync.conflicts[0].field, "status");

    const resolved = await workbook.resolveConflict("forms-301", "status", "workbook");
    assert.equal(records[0].status, "Submitted");
    assert.equal(records[0].storeTeamNotes, "Workbook note");
    assert.equal(rows[0].Status, "Submitted");
    assert.equal(rows[0]["EnQuote Store Team Notes"], "Workbook note");
    assert.equal(resolved.conflicts.length, 0);
    assert.equal(workbook.syncStatus().conflicts.length, 0);

    rows.splice(0);
    const removed = await workbook.sync();
    assert.equal(removed.deleted, 1);
    assert.equal(records.length, 0);
    assert.equal(rows.length, 0);
    rows.push({...row});
    const stale = await workbook.sync();
    assert.equal(stale.imported, 0);
    assert.equal(rows.length, 0);

    oneDriveEmail = "different@example.com";
    await assert.rejects(workbook.sync(), /same work account/);
  } finally {
    if (previousOneDrive === undefined) delete process.env.OneDriveCommercial;
    else process.env.OneDriveCommercial = previousOneDrive;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("shared-copy detection and workbook operations are serialized and enforce destination and processor guards", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-refund-queue-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const previous = process.env.OneDriveCommercial;
  process.env.OneDriveCommercial = root;
  t.after(() => {
    if (previous === undefined) delete process.env.OneDriveCommercial;
    else process.env.OneDriveCommercial = previous;
  });
  const folder = path.join(root, "Customer Financing and O&M Marketplace - Care - Cancel requests");
  fs.mkdirSync(folder);
  const workbookPath = path.join(folder, "EnQuote_Care_Refund_Tracker.xlsx");
  fs.writeFileSync(workbookPath, "");
  let active = 0, maximum = 0, deny = false, fail = false, calls = 0;
  const workbook = createRefundWorkbook({
    storageDir: path.join(root, "app"),
    getEmail: () => "processor@example.com", getOneDriveEmail: async () => "processor@example.com",
    client: {post: async () => {if (deny) throw new Error("Processor required"); return {ok: true};}},
    runWorkbook: async () => {
      active++; calls++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      if (fail) {fail = false; throw new Error("Excel busy");}
      return {ok: true, tableName: "Table2", headers: ["ID"], rows: []};
    }
  });
  assert.equal((await workbook.status()).path, workbookPath);
  await Promise.all([workbook.read(), workbook.write([]), workbook.status(), workbook.read()]);
  assert.equal(maximum, 1);
  fail = true;
  const results = await Promise.allSettled([workbook.read(), workbook.read()]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  await assert.rejects(workbook.write([], path.join(folder, "other.xlsx")), /workbook changed/);
  deny = true;
  const priorCalls = calls;
  await assert.rejects(workbook.sync(), /Processor required/);
  assert.equal(calls, priorCalls);
});

test("shared tracker automatically replaces an old connection and never falls back when unavailable", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-refund-default-"));
  const previous = process.env.OneDriveCommercial;
  process.env.OneDriveCommercial = root;
  t.after(() => {
    if (previous === undefined) delete process.env.OneDriveCommercial;
    else process.env.OneDriveCommercial = previous;
    fs.rmSync(root, {recursive: true, force: true});
  });
  const storageDir = path.join(root, "app");
  fs.mkdirSync(storageDir);
  const oldPath = path.join(root, "old.xlsx");
  fs.writeFileSync(oldPath, "");
  fs.writeFileSync(path.join(storageDir, "refund-workbook.json"), JSON.stringify({path: oldPath}));
  fs.writeFileSync(path.join(storageDir, "refund-workbook-sync.json"), JSON.stringify({baseline: {old: {}}, conflicts: [{field: "status"}]}));
  const operations = [];
  const workbook = createRefundWorkbook({
    storageDir, getEmail: () => "processor@example.com",
    getOneDriveEmail: async () => "processor@example.com",
    dialog: {showOpenDialog: () => {throw new Error("Must not browse");}},
    runWorkbook: async (operation, target) => {
      operations.push({operation, target});
      return {ok: true, tableName: "Table2", headers: ["ID"], rows: []};
    }
  });
  assert.equal((await workbook.status()).configured, false);
  await assert.rejects(workbook.read(), /Waiting for OneDrive/);
  await assert.rejects(workbook.write([]), /Waiting for OneDrive/);
  assert.equal(operations.length, 0);
  const folder = path.join(root, "Care - Cancel requests");
  fs.mkdirSync(folder);
  const sharedPath = path.join(folder, WORKBOOK_NAME);
  fs.writeFileSync(sharedPath, "");
  assert.equal((await workbook.select()).path, sharedPath);
  assert.equal(JSON.parse(fs.readFileSync(path.join(storageDir, "refund-workbook.json"))).path, sharedPath);
  assert.deepEqual(workbook.syncStatus().conflicts, []);
  await workbook.write([]);
  assert.ok(operations.every(({target}) => target === sharedPath));
  fs.unlinkSync(sharedPath);
  assert.equal((await workbook.status()).configured, false);
  await assert.rejects(workbook.write([]), /Waiting for OneDrive/);
});
