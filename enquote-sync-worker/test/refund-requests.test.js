import assert from "node:assert/strict";
import {test} from "node:test";
import {createCollabD1} from "../test-helpers/d1Shim.js";
import {
  handleRefundRequestIngest,
  handleRefundRequestCsvIngest,
  handleRefundRequestSubmit,
  handleRefundRequestNativeSubmit,
  handleRefundRequestWorkbookSync,
  handleRefundRequestsList,
  handleRefundRequestUpdate
} from "../src/refund-requests.js";
import {signUserToken} from "../src/user-token.js";

const SECRET = "refund-test-user-token-secret";
const OUTBOUND_TOKEN = "refund-test-outbound-token";
const INGEST_TOKEN = "refund-test-ingest-token";
const PEOPLE = [
  {email: "processor@example.com", app_role: "invoicer", full_name: "Pat Processor"},
  {email: "leader@example.com", app_role: "approver", full_name: "Alex Leader"},
  {email: "reader@example.com", app_role: "submitter", full_name: "Rae Reader"}
];

function makeEnv() {
  const env = {
    DB: createCollabD1(),
    CACHE: {
      async get() {
        return {users: PEOPLE, fetchedAt: Date.now()};
      }
    },
    USER_TOKEN_SECRET: SECRET,
    OUTBOUND_TOKEN,
    ALLOWED_EMAILS_LIST: PEOPLE.map((person) => person.email).join(","),
    REFUND_INGEST_TOKEN: INGEST_TOKEN,
    broadcasts: [],
    QUOTE_SYNC_ROOM: {
      idFromName: (name) => name,
      get: () => ({fetch: async (_url, init) => { env.broadcasts.push(JSON.parse(init.body)); return new Response("{}"); }})
    }
  };
  return env;
}

async function userRequest(path, email, {method = "GET", body} = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${OUTBOUND_TOKEN}`,
      "X-EnQuote-User": await signUserToken(email, SECRET),
      ...(body ? {"Content-Type": "application/json"} : {})
    },
    ...(body ? {body: JSON.stringify(body)} : {})
  });
}

function submission(externalResponseId = "resp-101", overrides = {}) {
  return {
    externalResponseId,
    submittedAt: "2026-10-08T12:00:00.000Z",
    requestorName: "Riley Requestor",
    requestorDepartment: "Customer Care",
    requestorEmail: "riley@example.com",
    subscriptionId: "SUB-123",
    siteId: "SITE-456",
    customerName: "Taylor Customer",
    refundAmountRequested: 129.95,
    refundReason: "Duplicate charge",
    siteVisitCompleted: true,
    refundType: "Partial Refund",
    leadershipApprovalRequired: true,
    leadershipApprovalJustification: "Amount exceeds the standard approval threshold.",
    additionalNotes: "Original form note.",
    ...overrides
  };
}

async function ingest(env, body = submission(), authorization = `Bearer ${INGEST_TOKEN}`) {
  return handleRefundRequestIngest(new Request("https://worker.example/api/refund-requests/ingest", {
    method: "POST",
    headers: {Authorization: authorization, "Content-Type": "application/json"},
    body: JSON.stringify(body)
  }), env);
}

async function ingestCsv(env, csv, authorization = `Bearer ${INGEST_TOKEN}`) {
  return handleRefundRequestCsvIngest(new Request("https://worker.example/api/refund-requests/ingest-csv", {
    method: "POST",
    headers: {Authorization: authorization, "Content-Type": "text/csv"},
    body: csv
  }), env);
}

test("workbook deletions are processor-only, version-checked, audited and cannot be resurrected", async () => {
  const env = makeEnv();
  await ingest(env);
  const list = async () => (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  const current = (await list()).requests[0];
  const sync = async (email, body) => handleRefundRequestWorkbookSync(await userRequest(
    "/api/refund-requests/workbook-sync", email, {method: "POST", body}), env);
  const deletion = {externalResponseId: current.externalResponseId, expectedUpdatedAt: current.lastUpdatedAt};
  const body = {imports: [], updates: [], deletions: [deletion]};
  assert.equal((await sync("reader@example.com", body)).status, 403);
  assert.equal((await sync("processor@example.com", {...body, deletions: [{...deletion, expectedUpdatedAt: "invalid"}]})).status, 400);
  const stale = await (await sync("processor@example.com", {...body, deletions: [
    {...deletion, expectedUpdatedAt: "2000-01-01T00:00:00.000Z"}
  ]})).json();
  assert.equal(stale.deleted, 0);
  assert.equal(stale.conflicts[0].reason, "record_changed");
  assert.equal((await list()).requests.length, 1);
  const removed = await (await sync("processor@example.com", body)).json();
  assert.equal(removed.deleted, 1);
  const empty = await list();
  assert.equal(empty.requests.length, 0);
  assert.deepEqual(empty.deletedExternalResponseIds, [current.externalResponseId]);
  const again = await (await sync("processor@example.com", body)).json();
  assert.equal(again.deleted, 0);
  const staleImport = await (await sync("processor@example.com", {imports: [submission()], updates: []})).json();
  assert.equal(staleImport.imported, 0);
  assert.equal((await ingest(env)).status, 409);
  assert.equal((await list()).requests.length, 0);
  assert.equal((await handleRefundRequestUpdate(await userRequest("/api/refund-requests/update", "processor@example.com", {
    method: "POST", body: {requestId: current.id, expectedStatus: current.status,
      expectedUpdatedAt: current.lastUpdatedAt, changes: {storeTeamNotes: "Should not return"}}
  }), env)).status, 404);
  const audits = await env.DB.prepare("SELECT * FROM refund_request_audit WHERE request_id = ?").bind(current.id).all();
  assert.ok(audits.results.some((row) => row.action === "workbook_row_deleted"));
});

test("EnQuote form submission is saved without a Power Automate dependency", async () => {
  const env = makeEnv();
  env.REFUND_TRACKING_FLOW_URL = undefined;
  const response = await handleRefundRequestSubmit(await userRequest("/api/refund-requests/submit", "reader@example.com", {
    method: "POST",
    body: submission("client-supplied-id", {requestorEmail: "forged@example.com"})
  }), env);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.request.requestorEmail, "reader@example.com");
  assert.match(payload.request.externalResponseId, /^enquote-/);
  assert.equal(payload.request.status, "Submitted");
  assert.equal(env.REFUND_TRACKING_FLOW_URL, undefined);
  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests.length, 1);
});

function nativeAnswers(overrides = {}) {
  return {
    submissionId: crypto.randomUUID(), cancellationTiming: "Immediately",
    refundChoice: "Partial refund", servicesCompleted: "No", customerEscalated: "Yes",
    siteId: "SITE-1", subscriptionId: "SUB-1", customerName: "Customer",
    customerEmail: "customer@example.com", caseNumber: "CASE-1",
    refundReason: "Other", otherReason: "A specific reason", additionalNotes: "Detailed explanation",
    ...overrides
  };
}

test("Native form persists every live question, identifies the caller and is idempotent per user", async () => {
  const env = makeEnv();
  const answers = nativeAnswers({requestorEmail: "forged@example.com", requestorName: "Forged"});
  const submit = (email, body) => userRequest("/api/refund-requests/submit-native", email, {method: "POST", body})
    .then((request) => handleRefundRequestNativeSubmit(request, env));
  const first = await submit("reader@example.com", answers);
  assert.equal(first.status, 201);
  const saved = (await first.json()).request;
  assert.equal(saved.requestorEmail, "reader@example.com");
  assert.equal(saved.requestorName, "Rae Reader");
  assert.equal(saved.cancellationTiming, answers.cancellationTiming);
  assert.equal(saved.customerEmail, answers.customerEmail);
  assert.equal(saved.caseNumber, answers.caseNumber);
  assert.equal(saved.otherReason, answers.otherReason);
  assert.equal(saved.servicesCompleted, false);
  assert.equal(saved.customerEscalated, true);
  assert.equal(saved.refundAmountRequested, null);
  assert.ok(saved.missingEnQuoteFields.includes("refundAmountRequested"));
  assert.ok(saved.missingEnQuoteFields.includes("requestorDepartment"));
  const repeat = await submit("reader@example.com", answers);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).request.id, saved.id);
  assert.equal((await submit("processor@example.com", answers)).status, 201);
  const none = await submit("reader@example.com", nativeAnswers({refundChoice: "No refund", servicesCompleted: "stale"}));
  assert.equal(none.status, 201);
  assert.equal((await none.json()).request.servicesCompleted, null);
});

test("Native form rejects missing and invalid conditional answers before saving", async () => {
  const env = makeEnv();
  for (const overrides of [
    {submissionId: "invalid"}, {cancellationTiming: "Later"}, {refundChoice: "Unknown"},
    {customerEmail: "invalid"}, {caseNumber: ""}, {otherReason: ""},
    {servicesCompleted: null}, {additionalNotes: ""}, {customerEscalated: "Maybe"}
  ]) {
    const response = await handleRefundRequestNativeSubmit(await userRequest(
      "/api/refund-requests/submit-native", "reader@example.com", {method: "POST", body: nativeAnswers(overrides)}
    ), env);
    assert.equal(response.status, 400);
  }
  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests.length, 0);
});

test("Forms CSV import maps response columns, preserves quoted fields and deduplicates rows", async () => {
  const env = makeEnv();
  const csv = [
    "ID,Start time,Completion time,Email,Name,Requestor Department,Subscription ID,Site ID,Customer Name,Refund Amount Requested,Refund Reason,Site Visit Completed,Refund Type,Leadership Approval Required,Leadership Approval Justification,Additional Notes",
    '101,10/8/2026 8:00 AM,10/8/2026 8:05 AM,riley@example.com,Riley Requestor,Customer Care,SUB-123,SITE-456,"Taylor, Customer",129.95,"Duplicate, charge",Yes,Partial Refund,Yes,"Approved by leadership",Original note'
  ].join("\r\n");
  assert.equal((await ingestCsv(env, csv, "Bearer bad-token")).status, 401);
  const response = await ingestCsv(env, csv);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual({created: payload.created, duplicates: payload.duplicates, total: payload.total}, {
    created: 1, duplicates: 0, total: 1
  });

  const duplicate = await ingestCsv(env, csv);
  assert.equal((await duplicate.json()).duplicates, 1);
  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests.length, 1);
  assert.equal(listed.requests[0].customerName, "Taylor, Customer");
  assert.equal(listed.requests[0].refundReason, "Duplicate, charge");
});

test("Forms CSV import validates every row before writing", async () => {
  const env = makeEnv();
  const csv = [
    "ID,Completion time,Email,Name,Requestor Department,Subscription ID,Site ID,Customer Name,Refund Amount Requested,Refund Reason,Site Visit Completed,Refund Type,Leadership Approval Required,Leadership Approval Justification",
    "101,10/8/2026 8:05 AM,riley@example.com,Riley Requestor,Customer Care,SUB-123,SITE-456,Taylor Customer,129.95,Duplicate charge,No,Partial Refund,No,",
    "102,invalid date,not-an-email,Riley Requestor,Customer Care,SUB-124,SITE-457,Taylor Customer,invalid,Missing fields,maybe,Other,No,"
  ].join("\n");
  const response = await ingestCsv(env, csv);
  assert.equal(response.status, 400);
  assert.deepEqual((await response.json()).rows, [3]);
  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests.length, 0);
});

test("Forms ingestion validates values, requires machine authentication and deduplicates response IDs", async () => {
  const env = makeEnv();
  assert.equal((await ingest(env, submission(), "Bearer wrong")).status, 401);
  assert.equal((await ingest(env, submission("bad", {refundAmountRequested: -1}))).status, 400);
  assert.equal((await ingest(env, submission("bad", {leadershipApprovalRequired: "yes"}))).status, 400);

  const first = await ingest(env);
  assert.equal(first.status, 201);
  const firstPayload = await first.json();
  assert.equal(firstPayload.created, true);
  assert.equal(firstPayload.request.status, "Submitted");
  assert.equal(firstPayload.request.refundAmountRequested, 129.95);

  const duplicate = await ingest(env, submission("resp-101", {customerName: "Changed retry payload"}));
  assert.equal(duplicate.status, 200);
  const duplicatePayload = await duplicate.json();
  assert.equal(duplicatePayload.created, false);
  assert.equal(duplicatePayload.request.customerName, "Taylor Customer");

  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests.length, 1);
  assert.equal(listed.requests[0].externalResponseId, "resp-101");
});

test("Workbook sync imports incomplete rows and leaves missing EnQuote fields explicit", async () => {
  const env = makeEnv();
  const row = {
    externalResponseId: "tracker-201",
    submittedAt: null,
    requestorName: "Tracker Requestor",
    requestorEmail: "tracker@example.com",
    subscriptionId: "SUB-201",
    siteId: "SITE-201",
    customerName: "Tracker Customer",
    refundAmountRequested: 250,
    refundReason: "Form row"
  };
  const sync = async (email, imports, updates = []) => handleRefundRequestWorkbookSync(await userRequest(
    "/api/refund-requests/workbook-sync",
    email,
    {method: "POST", body: {imports, updates}}
  ), env);

  assert.equal((await sync("reader@example.com", [row])).status, 403);
  const malformed = await sync("processor@example.com", [row, {...row, externalResponseId: "bad", refundAmountRequested: "250"}]);
  assert.equal(malformed.status, 400);
  const empty = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(empty.requests.length, 0);

  const response = await sync("processor@example.com", [row]);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).imported, 1);
  const listed = await (await handleRefundRequestsList(await userRequest("/api/refund-requests", "reader@example.com"), env)).json();
  assert.equal(listed.requests[0].submittedAt, null);
  assert.ok(listed.requests[0].missingEnQuoteFields.includes("submittedAt"));
  assert.ok(listed.requests[0].missingEnQuoteFields.includes("requestorDepartment"));
});

test("Workbook updates require processor access and reject stale versions", async () => {
  const env = makeEnv();
  const created = await (await ingest(env)).json();
  const update = async (email, expectedUpdatedAt, changes) => handleRefundRequestWorkbookSync(
    await userRequest("/api/refund-requests/workbook-sync", email, {
      method: "POST",
      body: {
        imports: [],
        updates: [{externalResponseId: created.request.externalResponseId, expectedUpdatedAt, changes}]
      }
    }),
    env
  );

  assert.equal((await update("reader@example.com", created.request.lastUpdatedAt, {status: "Under Review"})).status, 403);
  const success = await update("processor@example.com", created.request.lastUpdatedAt, {status: "Under Review"});
  assert.equal((await success.json()).updated, 1);
  const stale = await update("processor@example.com", created.request.lastUpdatedAt, {status: "Cancelled"});
  assert.equal((await stale.json()).conflicts[0].reason, "record_changed");
});

test("Legacy stored statuses list and update through normalized statuses with stale-write protection", async () => {
  for (const [legacy, normalized] of [["New", "Submitted"], ["Processed", "Completed"], ["Closed", "Completed"]]) {
    const env = makeEnv();
    const {request: created} = await (await ingest(env)).json();
    const stored = {...created, status: legacy};
    await env.DB.prepare("UPDATE refund_requests SET data = ? WHERE id = ?")
      .bind(JSON.stringify(stored), created.id).run();
    const listed = await (await handleRefundRequestsList(
      await userRequest("/api/refund-requests", "processor@example.com"), env
    )).json();
    assert.equal(listed.requests[0].status, normalized);
    const body = {requestId: created.id, expectedStatus: normalized, expectedUpdatedAt: created.lastUpdatedAt,
      changes: {storeTeamNotes: "Updated legacy request"}};
    const response = await handleRefundRequestUpdate(await userRequest(
      "/api/refund-requests/update", "processor@example.com", {method: "POST", body}
    ), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).request.status, normalized);
    const stale = await handleRefundRequestUpdate(await userRequest(
      "/api/refund-requests/update", "processor@example.com", {method: "POST", body}
    ), env);
    assert.equal(stale.status, 409);
  }
});

test("Workflow enforces roles, six tracker statuses, approval fields and audit attribution", async () => {
  const env = makeEnv();
  const created = await (await ingest(env)).json();
  const id = created.request.id;
  const initialUpdatedAt = created.request.lastUpdatedAt;
  let updatedAt = created.request.lastUpdatedAt;
  const update = async (email, status, changes) => {
    const response = await handleRefundRequestUpdate(await userRequest("/api/refund-requests/update", email, {
      method: "POST",
      body: {requestId: id, expectedStatus: status, expectedUpdatedAt: updatedAt, changes}
    }), env);
    if (response.ok) updatedAt = (await response.clone().json()).request.lastUpdatedAt;
    return response;
  };

  assert.equal((await update("reader@example.com", "Submitted", {status: "Under Review"})).status, 403);
  assert.equal((await update("reader@example.com", "Submitted", {refundProcessedDate: "2026-10-08T13:00:00.000Z"})).status, 403);
  assert.equal((await update("processor@example.com", "Submitted", {refundProcessedDate: "not-a-date"})).status, 400);
  assert.equal((await update("processor@example.com", "Submitted", {refundProcessedDate: "2026-10-08T13:00:00.000Z"})).status, 200);
  assert.equal((await update("processor@example.com", "Submitted", {status: "Unknown"})).status, 400);
  assert.equal((await update("processor@example.com", "Submitted", {status: "Approved"})).status, 403);
  assert.equal((await update("processor@example.com", "Submitted", {status: "Denied"})).status, 200);
  assert.equal((await update("processor@example.com", "Denied", {status: "Cancelled"})).status, 200);
  assert.equal((await update("processor@example.com", "Cancelled", {status: "Submitted"})).status, 200);
  assert.equal((await update("processor@example.com", "Submitted", {status: "Under Review"})).status, 200);
  const staleUpdate = await handleRefundRequestUpdate(await userRequest("/api/refund-requests/update", "processor@example.com", {
    method: "POST",
    body: {requestId: id, expectedStatus: "Under Review", expectedUpdatedAt: initialUpdatedAt, changes: {storeTeamNotes: "stale"}}
  }), env);
  assert.equal(staleUpdate.status, 409);
  assert.equal((await update("processor@example.com", "Under Review", {storeTeamNotes: "Reviewed", escalationNotes: "Escalated"})).status, 200);
  assert.equal((await update("processor@example.com", "Under Review", {status: "Approved"})).status, 403);
  assert.equal((await update("leader@example.com", "Under Review", {status: "Approved"})).status, 200);

  assert.equal((await update("leader@example.com", "Approved", {leadershipApprover: "", approvalDate: null})).status, 200);
  const missingApproval = await update("processor@example.com", "Approved", {status: "Completed"});
  assert.equal(missingApproval.status, 409);
  assert.equal((await update("leader@example.com", "Approved", {
    leadershipApprover: "Alex Leader",
    approvalDate: "2026-10-08T13:00:00.000Z"
  })).status, 200);

  const processed = await (await update("processor@example.com", "Approved", {status: "Completed"})).json();
  assert.equal(processed.request.status, "Completed");
  assert.equal(processed.request.processorName, "Pat Processor");
  assert.ok(processed.request.refundProcessedDate);
  assert.equal(processed.request.refundProcessedDate, "2026-10-08T13:00:00.000Z");
  assert.equal(processed.request.storeTeamNotes, "Reviewed");
  assert.equal(processed.request.escalationNotes, "Escalated");
  assert.equal((await update("processor@example.com", "Completed", {status: "Cancelled"})).status, 200);

  const audit = await env.DB.prepare("SELECT actor, action, details FROM refund_request_audit WHERE request_id = ? ORDER BY id").bind(id).all();
  assert.ok(audit.results.some((event) => event.actor === "leader@example.com" && event.details.includes("Approved")));
  assert.ok(audit.results.some((event) => event.actor === "processor@example.com" && event.details.includes("processorName")));
  assert.ok(env.broadcasts.some((event) => event.type === "refund_requests_updated"));
});
