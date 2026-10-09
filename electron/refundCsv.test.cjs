const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createRefundCsv, appendRequest, parseCsv, HEADERS} = require("./refundCsv.cjs");
const {validateAnswers, visibleQuestions} = require("../shared/refundForm.cjs");

function answers(overrides = {}) {
  return {cancellationTiming: "Immediately", refundChoice: "Full refund", servicesCompleted: "Yes",
    customerEscalated: "No", siteId: "SITE-1", subscriptionId: "SUB-1", customerName: "Customer",
    customerEmail: "customer@example.com", caseNumber: "1", refundReason: "Other",
    otherReason: 'Quotes "and", commas\nand newline', additionalNotes: "=SUM(A1:A2)", ...overrides};
}

test("native schema follows all three refund choices and Other branching", () => {
  assert.equal(visibleQuestions({}).length, 2);
  for (const refundChoice of ["No refund", "Full refund", "Partial refund"]) {
    const value = answers({refundChoice});
    const validated = validateAnswers(value);
    assert.ok(validated);
    assert.equal(visibleQuestions(value).length, refundChoice === "No refund" ? 11 : 12);
    assert.equal(validated.servicesCompleted, refundChoice === "No refund" ? null : "Yes");
    assert.equal(validateAnswers({...value, customerEmail: "bad"}), null);
  }
  const value = answers({refundReason: "Customer dissatisfaction", otherReason: "stale"});
  assert.equal(validateAnswers(value).otherReason, null);
  assert.equal(visibleQuestions(value).some((question) => question.key === "otherReason"), false);
});

test("CSV appends all question answers, quotes safely, deduplicates retries, and preserves incompatible files", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-csv-test-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  const file = path.join(dir, "requests.csv");
  const request = {...answers(), externalResponseId: "native-1", submittedAt: "2026-10-09T15:00:00.000Z",
    requestorEmail: "requester@example.com", requestorName: "Requester", status: "Submitted"};
  appendRequest(file, request);
  appendRequest(file, request);
  appendRequest(file, {...request, externalResponseId: "native-2"});
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  assert.deepEqual(rows[0], HEADERS);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][HEADERS.indexOf('Add reason if the "Other" is selected')], request.otherReason);
  assert.equal(rows[1][HEADERS.indexOf("Detailed explanation of the refund request")], "'=SUM(A1:A2)");
  fs.writeFileSync(file, "Different,Columns\r\n1,2\r\n");
  assert.throws(() => appendRequest(file, request), /Existing columns/);
  assert.equal(fs.readFileSync(file, "utf8"), "Different,Columns\r\n1,2\r\n");
  assert.deepEqual(fs.readdirSync(dir), ["requests.csv"]);
});

test("CSV failures persist for retry across restart without another server submission; settings are account scoped", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-csv-retry-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  const file = path.join(dir, "requests.csv");
  let posts = 0, email = "first@example.com";
  const create = () => createRefundCsv({
    storageDir: dir, getEmail: () => email, getMainWindow: () => null,
    dialog: {showSaveDialog: async () => ({filePath: file})},
    client: {post: async (_route, body) => {
      posts++;
      return {ok: true, request: {...body, externalResponseId: "native-one", requestorEmail: email, status: "Submitted"}};
    }}
  });
  let service = create();
  await service.select();
  fs.writeFileSync(`${file}.enquote-lock`, "");
  const result = await service.submit(answers());
  assert.equal(result.saved, true);
  assert.equal(result.exported, false);
  assert.equal(service.status().pending, true);
  service = create();
  assert.equal(service.status().saved, true);
  await assert.rejects(service.submit(answers()), /pending/);
  fs.unlinkSync(`${file}.enquote-lock`);
  assert.equal((await service.retry()).exported, true);
  assert.equal(posts, 1);
  assert.equal(service.status().pending, false);
  email = "second@example.com";
  assert.equal(service.status().path, null);
  assert.equal(service.status().pending, false);
});

test("lost server response retries the durable submission ID rather than generating another request", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enquote-csv-response-"));
  t.after(() => fs.rmSync(dir, {recursive: true}));
  const ids = [];
  const service = createRefundCsv({
    storageDir: dir, getEmail: () => "requester@example.com", getMainWindow: () => null,
    dialog: {showSaveDialog: async () => ({filePath: path.join(dir, "requests.csv")})},
    client: {post: async (_route, body) => {
      ids.push(body.submissionId);
      if (ids.length === 1) throw new Error("Response lost");
      return {ok: true, request: {...body, externalResponseId: "native-one", status: "Submitted"}};
    }}
  });
  await service.select();
  await assert.rejects(service.submit(answers()), /Response lost/);
  assert.equal(service.status().saved, false);
  assert.equal((await service.retry()).exported, true);
  assert.equal(ids[0], ids[1]);
});
