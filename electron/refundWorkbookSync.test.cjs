const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSyncPlan,
  parseAmount,
  parseBoolean,
  recordToWorkbookRow,
  workbookRowToRecord
} = require("./refundWorkbookSync.cjs");

function workbookRow(overrides = {}) {
  return {
    ID: "forms-101",
    "Completion time": "2026-10-08T15:00:00.000Z",
    "Requester Email": "alex@example.com",
    "Requester Name": "Alex Requestor",
    "Customer name": "Customer One",
    "Subscription ID": "SUB-1",
    "Site ID": "SITE-1",
    "Refund amount (USD)": 120.5,
    "Primary reason for the cancel and/or refund request": "Duplicate payment",
    "Detailed explanation of the refund request": "Additional details",
    Status: "",
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    id: "internal-101",
    externalResponseId: "forms-101",
    submittedAt: "2026-10-08T15:00:00.000Z",
    requestorName: "Alex Requestor",
    requestorDepartment: null,
    requestorEmail: "alex@example.com",
    subscriptionId: "SUB-1",
    siteId: "SITE-1",
    customerName: "Customer One",
    refundAmountRequested: 120.5,
    refundReason: "Duplicate payment",
    siteVisitCompleted: null,
    refundType: null,
    leadershipApprovalRequired: null,
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
    missingEnQuoteFields: ["requestorDepartment", "refundType", "siteVisitCompleted", "leadershipApprovalRequired"],
    lastUpdatedAt: "2026-10-08T15:00:00.000Z",
    ...overrides
  };
}

test("missing previously synced rows delete tiles while new submissions are still written", () => {
  const old = request();
  const fresh = request({externalResponseId: "native-new"});
  const plan = buildSyncPlan([], [old, fresh], {[old.externalResponseId]: {status: "Submitted"}});
  assert.deepEqual(plan.deletions, [{externalResponseId: old.externalResponseId, expectedUpdatedAt: old.lastUpdatedAt}]);
  assert.deepEqual(plan.writeRows.map((row) => row.ID), ["native-new"]);
  assert.equal(plan.nextBaseline[old.externalResponseId], undefined);
  assert.equal(buildSyncPlan([], [old]).deletions.length, 0);
});

test("stale workbook copies cannot reimport tombstoned requests", () => {
  const plan = buildSyncPlan([workbookRow()], [], {}, ["forms-101"]);
  assert.equal(plan.imports.length, 0);
  assert.deepEqual(plan.deleteRows, ["forms-101"]);
});

test("workbook row mapping imports the matching form fields and flags missing EnQuote-only fields", () => {
  const mapped = workbookRowToRecord(workbookRow());
  assert.equal(mapped.externalResponseId, "forms-101");
  assert.equal(mapped.requestorEmail, "alex@example.com");
  assert.equal(mapped.refundAmountRequested, 120.5);
  assert.equal(mapped.status, "Submitted");
  assert.deepEqual(mapped.missingEnQuoteFields, [
    "requestorDepartment",
    "refundType",
    "siteVisitCompleted",
    "leadershipApprovalRequired"
  ]);
});

test("empty table rows do not prevent importing a real Forms response", () => {
  const plan = buildSyncPlan([{ID: null, Status: " "}, workbookRow({ID: 3})], []);
  assert.deepEqual(plan.invalidRows, []);
  assert.equal(plan.imports.length, 1);
  assert.equal(plan.imports[0].externalResponseId, "3");
});

test("populated rows without IDs and duplicate IDs include their table row numbers", () => {
  const plan = buildSyncPlan([
    {ID: null, "Customer name": "Missing ID"},
    workbookRow({ID: 3}),
    workbookRow({ID: "3"})
  ], []);
  assert.deepEqual(plan.invalidRows, [
    {tableRow: 1, reason: "missing_response_id"},
    {tableRow: 3, externalResponseId: "3", reason: "duplicate_response_id"}
  ]);
});

test("workbook values update EnQuote when the app has not changed that field", () => {
  const base = request();
  const baseline = {"forms-101": {
    ...Object.fromEntries(Object.keys(base).map((key) => [key, base[key]])),
    status: "New"
  }};
  const changedRow = workbookRow({Status: "Under Review"});
  const plan = buildSyncPlan([changedRow], [base], baseline);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0].changes, {status: "Under Review"});
  assert.deepEqual(plan.conflicts, []);
});

test("nonconflicting EnQuote changes are written back to the workbook", () => {
  const baseline = {"forms-101": {status: "New", storeTeamNotes: ""}};
  const changed = request({status: "Under Review", lastUpdatedAt: "2026-10-08T15:02:00.000Z"});
  const plan = buildSyncPlan([workbookRow({Status: "New"})], [changed], baseline);
  assert.equal(plan.writeRows.length, 1);
  assert.equal(plan.writeRows[0].Status, "Under Review");
  assert.equal(plan.conflicts.length, 0);
});

test("same-field concurrent edits are returned as conflicts without choosing a winner", () => {
  const base = request();
  const baseline = {"forms-101": {
    ...Object.fromEntries(Object.keys(base).map((key) => [key, base[key]])),
    status: "New"
  }};
  const changed = request({status: "Approved"});
  const plan = buildSyncPlan([workbookRow({Status: "Under Review"})], [changed], baseline);
  assert.deepEqual(plan.conflicts, [{
    externalResponseId: "forms-101",
    field: "status",
    workbookValue: "Under Review",
    enquoteValue: "Approved"
  }]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.writeRows.length, 0);
});

test("workbook serialization preserves existing columns and writes EnQuote fields", () => {
  const serialized = recordToWorkbookRow(request({status: "Processed", refundProcessedDate: "2026-10-08T16:00:00.000Z"}), {
    "Case number": "CASE-1",
    "Does this cancel request also require a refund?": "Yes"
  });

  assert.equal(serialized["Case number"], "CASE-1");
  assert.equal(serialized["Does this cancel request also require a refund?"], "Yes");
  assert.equal(serialized.Status, "Completed");
  assert.equal(serialized["EnQuote Refund Processed Date"], "2026-10-08T16:00:00.000Z");
});

test("legacy workbook, request, and baseline statuses do not create spurious conflicts", () => {
  for (const [legacy, normalized] of [["New", "Submitted"], ["Processed", "Completed"], ["Closed", "Completed"]]) {
    const base = request({status: legacy});
    const plan = buildSyncPlan([workbookRow({Status: legacy})], [base], {"forms-101": base});
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.writeRows, []);
    assert.equal(plan.nextBaseline["forms-101"].status, normalized);
    const added = buildSyncPlan([], [base]);
    assert.equal(added.writeRows[0].Status, normalized);
    assert.equal(added.nextBaseline["forms-101"].status, normalized);
  }
});

test("native form answers round-trip through the tracker without losing case and customer data", () => {
  const saved = request({
    cancellationTiming: "At the end of the current term", refundChoice: "No refund",
    servicesCompleted: null, customerEscalated: true, customerEmail: "customer@example.com",
    caseNumber: "CASE-001", otherReason: "Detailed other reason"
  });
  const row = recordToWorkbookRow(saved);
  const restored = workbookRowToRecord(row);
  for (const field of ["cancellationTiming", "refundChoice", "servicesCompleted", "customerEscalated", "customerEmail", "caseNumber", "otherReason"]) {
    assert.equal(restored[field], saved[field]);
  }
});

test("workbook field parsers reject invalid amounts and preserve unknown booleans as null", () => {
  assert.equal(parseAmount("$1,200.00"), 1200);
  assert.equal(parseAmount("not an amount"), null);
  assert.equal(parseBoolean("Yes"), true);
  assert.equal(parseBoolean("unknown"), null);
});
