const assert = require("node:assert/strict");
const test = require("node:test");
const settings = require("../shared/refundSharePoint.json");
const {configurationIssues, createRefundSharePointClient} = require("./refundSharePoint.cjs");

const UUID = "12345678-1234-1234-1234-123456789abc";
const config = {
  ...settings.native, tenantId: UUID, clientId: UUID,
  graphSiteId: `enphase.sharepoint.com,${UUID},${UUID}`
};
const root = `https://graph.microsoft.com/v1.0/sites/${config.graphSiteId}/lists/${config.testListId}`;
const names = [
  "Title", "Submission Key", "Submission Source", "Requester Email", "Submitted At",
  "Request Status", "Manager Approved", "Integration Status", "Cancellation Timing",
  "Refund Choice", "Refund Amount (USD)", "Services Completed", "Customer Escalated",
  "Site ID", "Subscription ID", "Customer Name", "Customer Email", "Case Number",
  "Primary Reason", "Other Reason", "Detailed Explanation", "Store Team Notes", "Escalation Notes"
];
const metadata = names.map((displayName, index) => ({displayName, name: `field${index}`}));
const field = (name) => metadata.find((column) => column.displayName === name).name;
const submission = {
  submissionId: UUID, requesterEmail: "requester@example.com", submittedAt: "2026-10-16T20:00:00Z",
  answers: {
    cancellationTiming: "Immediately", refundChoice: "Partial refund", refundAmountRequested: "129.95",
    servicesCompleted: "No", customerEscalated: "No", siteId: "TEST-SITE",
    subscriptionId: "TEST-SUB", customerName: "TEST Customer", customerEmail: "test@example.com",
    caseNumber: "TEST-CASE", refundReason: "Other", otherReason: "TEST reason", additionalNotes: "TEST explanation"
  }
};
const reply = (value, status = 200, headers = {}) =>
  new Response(status === 204 ? null : JSON.stringify(value), {status, headers});

function setup(handler, overrides = {}) {
  const calls = [];
  const client = createRefundSharePointClient({
    config, getAccessToken: async () => "synthetic-token",
    fetchImpl: async (url, options) => {
      calls.push({url, ...options});
      assert.equal(options.headers.Authorization, "Bearer synthetic-token");
      assert.equal(options.redirect, "error");
      if (url.includes("/columns?")) return reply({value: metadata});
      return handler(url, options);
    },
    ...overrides
  });
  return {client, calls};
}

test("native configuration is deliberately incomplete and cannot start network access", () => {
  assert.deepEqual(configurationIssues(settings.native), [
    "tenantId must be a valid GUID.", "clientId must be a valid GUID.",
    "graphSiteId must identify the approved enphase.sharepoint.com site."
  ]);
  assert.throws(() => createRefundSharePointClient({config: settings.native}), /configuration is incomplete/);
  assert.equal(settings.browser.formsIntakeEnabled, false);
  assert.deepEqual(configurationIssues(config), []);
  for (const patch of [
    {graphSiteId: `other.sharepoint.com,${UUID},${UUID}`},
    {scopes: ["Sites.ReadWrite.All"]}, {redirectUri: "https://example.com"},
    {refreshIntervalMs: 1}, {testListId: "wrong"}
  ]) assert.ok(configurationIssues({...config, ...patch}).length);
});

test("list reads every Graph page and defaults to the test List", async () => {
  const next = `${root}/items?$skiptoken=page2`;
  const {client, calls} = setup((url) => reply(url === next
    ? {value: [{id: "2", eTag: '"2"'}]}
    : {value: [{id: "1", eTag: '"1"'}], "@odata.nextLink": next}));
  assert.deepEqual((await client.list()).map((item) => item.id), ["1", "2"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.startsWith(`${root}/`)));
});

test("pagination cannot forward Microsoft credentials elsewhere or return incomplete results", async () => {
  for (const next of [
    "https://example.com/items", "https://graph.microsoft.com/v1.0/me",
    `${root}/../another-list/items`, `${root}/%2e%2e/another-list/items`,
    `${root}/items?$expand=fields&$top=200`
  ]) {
    const {client, calls} = setup(() => reply({value: [{id: "1"}], "@odata.nextLink": next}));
    await assert.rejects(client.list(), /pagination/);
    assert.equal(calls.length, 1);
  }
  const {client} = setup(() => reply({value: null}));
  await assert.rejects(client.list(), /invalid collection/);
});

test("submission resolves actual internal names and preserves numeric amounts", async () => {
  const {client, calls} = setup((_url, options) => options.method === "POST"
    ? reply({id: "1", eTag: '"1"'}, 201) : reply({value: []}));
  assert.equal((await client.submit(submission)).created, true);
  const fields = JSON.parse(calls.find((call) => call.method === "POST").body).fields;
  assert.equal(fields[field("Submission Key")], `enquote:${UUID}`);
  assert.equal(fields[field("Refund Amount (USD)")], 129.95);
  assert.equal(fields[field("Request Status")], "Submitted");
  assert.equal(fields[field("Integration Status")], "Pending");
  assert.equal(fields[field("Detailed Explanation")], "TEST explanation");
  assert.ok(decodeURIComponent(calls[1].url).includes(`${field("Submission Key")} eq 'enquote:${UUID}'`));
});

test("zero is retained and conditional stale answers are removed before cloud writes", async () => {
  for (const [answers, expectedAmount, expectedServices] of [
    [{refundAmountRequested: 0}, 0, "No"],
    [{refundChoice: "No refund", refundAmountRequested: "invalid", servicesCompleted: "Yes"}, null, null]
  ]) {
    const {client, calls} = setup((_url, options) => options.method === "POST" ? reply({id: "1"}, 201) : reply({value: []}));
    await client.submit({...submission, answers: {...submission.answers, ...answers, refundReason: "Customer dissatisfaction"}});
    const fields = JSON.parse(calls.find((call) => call.method === "POST").body).fields;
    assert.equal(fields[field("Refund Amount (USD)")], expectedAmount);
    assert.equal(fields[field("Services Completed")], expectedServices);
    assert.equal(fields[field("Other Reason")], null);
  }
});

test("invalid native amounts and submission identity are rejected before network calls", async () => {
  const {client, calls} = setup(() => {throw new Error("Must not call Graph");});
  for (const amount of [-1, "1.001", 1000000001, "", null, Infinity]) {
    await assert.rejects(client.submit({...submission, answers: {...submission.answers, refundAmountRequested: amount}}), /validation/);
  }
  await assert.rejects(client.submit({...submission, submissionId: "new-id"}), /UUID/);
  await assert.rejects(client.submit({...submission, requesterEmail: ""}), /verified requester email/);
  await assert.rejects(client.submit({...submission, submittedAt: "bad"}), /timestamp/);
  assert.equal(calls.length, 0);
});

test("duplicate replay returns the original record without resetting processing fields", async () => {
  const existing = {id: "9", eTag: '"2"', fields: {status: "Under Review", note: "retain"}};
  const {client, calls} = setup(() => reply({value: [existing]}));
  assert.deepEqual(await client.submit(submission), {item: existing, created: false});
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("concurrent duplicate conflict is reconciled only by the original submission key", async () => {
  let lookups = 0;
  const existing = {id: "3", fields: {status: "Under Review"}};
  const {client, calls} = setup((_url, options) => {
    if (options.method === "POST") return reply({}, 409);
    return reply({value: ++lookups === 1 ? [] : [existing]});
  });
  assert.deepEqual(await client.submit(submission), {item: existing, created: false});
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.url.includes("$filter=")).length, 2);
});

test("ambiguous keys and missing metadata fail explicitly instead of inventing fields", async () => {
  const {client} = setup(() => reply({value: [{id: "1"}, {id: "2"}]}));
  await assert.rejects(client.submit(submission), /Duplicate refund submission keys/);
  const missing = setup(() => reply({value: []}), {
    fetchImpl: async () => reply({value: metadata.filter((column) => column.displayName !== "Submission Key")})
  });
  await assert.rejects(missing.client.submit(submission), /missing the Submission Key/);
});

test("processing updates use If-Match and write only explicitly supported fields", async () => {
  const {client, calls} = setup(() => reply({}, 204));
  await client.updateProcessing({id: "2", eTag: '"item,2"', changes: {status: "Under Review", storeTeamNotes: "Reviewed"}});
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch.headers["If-Match"], '"item,2"');
  assert.deepEqual(JSON.parse(patch.body), {
    [field("Request Status")]: "Under Review", [field("Store Team Notes")]: "Reviewed"
  });
  const count = calls.length;
  for (const input of [
    {eTag: "*"}, {id: "../other"}, {changes: {}}, {changes: {managerApproved: "Yes"}},
    {changes: {status: "New"}}, {changes: {escalationNotes: "x".repeat(4001)}}
  ]) await assert.rejects(client.updateProcessing({id: "2", eTag: '"2"', changes: {status: "Submitted"}, ...input}));
  assert.equal(calls.length, count);
});

test("conflicts, access failures and throttling remain explicit and never auto-retry writes", async () => {
  for (const [status, message] of [[412, /changed in SharePoint/], [401, /expired/], [403, /denied/], [429, /HTTP 429/], [503, /HTTP 503/]]) {
    const {client, calls} = setup(() => reply({error: {message: "Do not expose a customer payload"}}, status, {"Retry-After": "30"}));
    await assert.rejects(client.updateProcessing({id: "2", eTag: '"2"', changes: {status: "Under Review"}}), (error) => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /customer payload|synthetic-token/);
      assert.equal(error.status, status);
      assert.equal(error.retryable, status === 429 || status === 503);
      assert.equal(error.retryAfter, "30");
      return true;
    });
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  }
});

test("timeouts, malformed responses, and sign-in absence are not reported as empty queues", async () => {
  const timeout = setup(() => {}, {
    timeoutMs: 5,
    fetchImpl: (_url, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
    })
  });
  await assert.rejects(timeout.client.list(), /timed out/);
  const invalid = setup(() => new Response("not JSON", {status: 200}));
  await assert.rejects(invalid.client.list(), /invalid JSON/);
  const unsigned = setup(() => {throw new Error("No network expected");}, {getAccessToken: async () => ""});
  await assert.rejects(unsigned.client.list(), /sign-in is required/);
  assert.equal(unsigned.calls.length, 0);
});
