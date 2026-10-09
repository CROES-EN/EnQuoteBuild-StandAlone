const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {createRefundSubmission} = require("./refundSubmission.cjs");

const answers = {
  cancellationTiming: "Immediately", refundChoice: "No refund", customerEscalated: "No",
  siteId: "123", subscriptionId: "456", customerName: "Customer", customerEmail: "customer@example.com",
  caseNumber: "789", refundReason: "Other", otherReason: "Reason", additionalNotes: "Details"
};

test("form writes to the connected Excel workbook and retries saved submissions without duplicates", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refund-submission-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  let failWrite = true, submissions = 0, writes = [];
  const calls = [];
  const options = {
    storageDir: dir, getEmail: () => "requester@example.com",
    client: {get: async () => ({ok: true, requests: [{externalResponseId: "native-one", status: "Under Review"}]}),
      post: async (route, payload) => {
      calls.push(route);
      if (route.endsWith("workbook-sync")) return {ok: true};
      submissions++;
      return {ok: true, request: {...payload, externalResponseId: "native-one", status: "Submitted",
        requestorEmail: "requester@example.com", submittedAt: "2026-10-09T17:00:00.000Z"}};
    }},
    workbook: {
      status: async () => ({ok: true, configured: true, path: "shared.xlsx"}),
      read: async () => ({ok: true}),
      write: async (rows) => {
        if (failWrite) throw new Error("Excel locked");
        writes.push(...rows);
      }
    }
  };
  let service = createRefundSubmission(options);
  const partial = await service.submit(answers);
  assert.equal(partial.saved, true);
  assert.equal(partial.written, false);
  assert.match(partial.error, /locked/);
  assert.equal((await service.status()).pending, true);
  assert.deepEqual(calls, ["/api/refund-requests/workbook-sync", "/api/refund-requests/submit-native"]);
  service = createRefundSubmission(options);
  await assert.rejects(service.submit(answers), /pending/);
  failWrite = false;
  const complete = await service.retry();
  assert.equal(complete.written, true);
  assert.equal(submissions, 1);
  assert.equal(writes[0].ID, "native-one");
  assert.equal(writes[0].Status, "Under Review");
  assert.equal((await service.status()).pending, false);
});

test("workbook submission checks connection and processor permissions before saving a request", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refund-submission-access-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  let connected = false, writes = 0, submissions = 0;
  const service = createRefundSubmission({
    storageDir: dir, getEmail: () => "requester@example.com",
    workbook: {
      status: async () => ({ok: true, configured: connected}),
      read: async () => {}, write: async () => {writes++;}
    },
    client: {post: async (route) => {
      if (route.endsWith("workbook-sync")) throw new Error("Processor access required");
      submissions++;
    }}
  });
  await assert.rejects(service.submit(answers), /Connect/);
  connected = true;
  await assert.rejects(service.submit(answers), /Processor/);
  assert.equal(submissions, 0);
  assert.equal(writes, 0);
  assert.equal((await service.status()).pending, false);
});

test("a lost server response retries the durable submission ID and refuses a changed destination", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refund-submission-retry-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  let email = "requester@example.com", destination = "original.xlsx", lost = true;
  const ids = [], written = [];
  const options = {
    storageDir: dir, getEmail: () => email,
    workbook: {
      status: async () => ({ok: true, configured: true, path: destination}),
      read: async () => ({ok: true}),
      write: async (rows, expectedPath) => {assert.equal(expectedPath, destination); written.push(...rows);}
    },
    client: {post: async (route, payload) => {
      if (route.endsWith("workbook-sync")) return {ok: true};
      ids.push(payload.submissionId);
      if (lost) {lost = false; throw new Error("Response lost");}
      return {ok: true, request: {...payload, externalResponseId: "native-id", status: "Submitted"}};
    }}
  };
  let service = createRefundSubmission(options);
  await assert.rejects(service.submit(answers), /Response lost/);
  service = createRefundSubmission(options);
  assert.equal((await service.status()).pending, true);
  await assert.rejects(service.select(), /pending/);
  email = "different@example.com";
  assert.equal((await service.status()).pending, false);
  await assert.rejects(service.retry(), /No pending/);
  email = "requester@example.com";
  destination = "different.xlsx";
  await assert.rejects(service.retry(), /original workbook/);
  assert.equal(written.length, 0);
  destination = "original.xlsx";
  assert.equal((await service.retry()).written, true);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(written.length, 1);
});

test("changing account during the workbook preflight never submits under the new account", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refund-submission-account-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  let email = "first@example.com", submissions = 0;
  const service = createRefundSubmission({
    storageDir: dir, getEmail: () => email,
    workbook: {
      status: async () => ({ok: true, configured: true, path: "tracker.xlsx"}),
      read: async () => {email = "second@example.com";}
    },
    client: {post: async (route) => {
      if (route.endsWith("workbook-sync")) return {ok: true};
      submissions++;
    }}
  });
  await assert.rejects(service.submit(answers), /account changed/);
  assert.equal(submissions, 0);
  assert.equal((await service.status()).pending, false);
});
