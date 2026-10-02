const assert = require("node:assert/strict");
const test = require("node:test");
const { createErrorReporter, fingerprintOf } = require("../../electron/errorReporter.cjs");

function makeReporter(overrides = {}) {
  const calls = [];
  const reporter = createErrorReporter({
    workerUrl: "https://w.example",
    getIdentity: () => ({ email: "Heather@Example.com" }),
    getToken: () => "t",
    getVersions: () => ({ appVersion: "1.0.14", uiVersion: "1.0.14+5" }),
    fetchImpl: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
    logger: { warn() {} },
    ...overrides
  });
  return { reporter, calls };
}

test("identical errors fold into one entry with a count", async () => {
  const { reporter, calls } = makeReporter();
  for (let i = 0; i < 5; i += 1) reporter.report({ source: "ErrorBoundary", message: `Cannot read item 12${i}`, stack: "Error\n    at Foo (app.js:10:5)" });
  assert.equal(reporter.pendingCount(), 1);
  const result = await reporter.flush();
  assert.equal(result.sent, 1);
  assert.equal(calls[0].body.errors[0].count, 5);
  assert.equal(calls[0].body.email, "heather@example.com");
  assert.equal(calls[0].body.uiVersion, "1.0.14+5");
  assert.equal(reporter.pendingCount(), 0);
});

test("different errors are kept separate and numbers in messages do not split them", () => {
  assert.equal(
    fingerprintOf({ source: "x", message: "failed for site 123", stack: "at A (a.js:1:1)" }),
    fingerprintOf({ source: "x", message: "failed for site 999", stack: "at A (a.js:9:9)" })
  );
  assert.notEqual(
    fingerprintOf({ source: "x", message: "one", stack: "at A (a.js:1:1)" }),
    fingerprintOf({ source: "x", message: "two", stack: "at A (a.js:1:1)" })
  );
});

test("a flood of distinct errors is capped per hour", () => {
  const { reporter } = makeReporter();
  let accepted = 0;
  for (let i = 0; i < 200; i += 1) if (reporter.report({ source: "s", message: `unique message ${"a".repeat(i)}`, stack: "" })) accepted += 1;
  assert.ok(accepted <= 40, `accepted ${accepted}`);
});

test("nothing is sent before sign-in credentials exist, and a failed send keeps the report for later", async () => {
  let token = "";
  let fail = true;
  const { reporter, calls } = makeReporter({
    getToken: () => token,
    fetchImpl: async (url, init) => {
      if (fail) throw new Error("offline");
      return { ok: true, status: 200, _: calls.push(JSON.parse(init.body)) };
    }
  });
  reporter.report({ source: "s", message: "boom", stack: "" });
  assert.equal((await reporter.flush()).reason, "no-credentials");

  token = "t";
  assert.equal((await reporter.flush()).sent, 0);
  assert.equal(reporter.pendingCount(), 1);

  fail = false;
  assert.equal((await reporter.flush()).sent, 1);
  assert.equal(reporter.pendingCount(), 0);
});

test("empty reports are ignored", () => {
  const { reporter } = makeReporter();
  assert.equal(reporter.report({ source: "s" }), false);
  assert.equal(reporter.pendingCount(), 0);
});
