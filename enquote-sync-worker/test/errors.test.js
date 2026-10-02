import assert from "node:assert/strict";
import { test } from "node:test";
import { handleErrorList, handleErrorReport } from "../src/errors.js";

const env = {
  OUTBOUND_TOKEN: "t",
  ALLOWED_EMAILS_LIST: "heather@example.com",
  DB: createDb()
};

function createDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        apply() {
          const [fingerprint, email, appVersion, uiVersion, source, message, stack, page, first, last, count] = params;
          const key = `${fingerprint}|${email}`;
          const existing = rows.get(key);
          rows.set(key, existing
            ? { ...existing, lastSeen: last, appVersion, uiVersion, occurrences: existing.occurrences + count }
            : { fingerprint, email, appVersion, uiVersion, source, message, stack, page, firstSeen: first, lastSeen: last, occurrences: count });
        },
        async all() { return { results: [...rows.values()] }; }
      };
    },
    async batch(statements) { statements.forEach((s) => s.apply()); return []; }
  };
}

const post = (body, token = "t") => new Request("https://w.example/api/errors", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body)
});

test("requires the token and an allow-listed email", async () => {
  assert.equal((await handleErrorReport(post({}, "wrong"), env)).status, 401);
  assert.equal((await handleErrorReport(post({ email: "x@y.com", errors: [] }), env)).status, 403);
});

test("stores reports, folds repeats into a counter, and lists them", async () => {
  const item = { fingerprint: "abc", source: "ErrorBoundary", message: "boom", stack: "at x", page: "#/Quotes", count: 2 };
  const first = await (await handleErrorReport(post({ email: "heather@example.com", appVersion: "1.0.14", uiVersion: "1.0.14+1", errors: [item] }), env)).json();
  assert.equal(first.stored, 1);
  await handleErrorReport(post({ email: "heather@example.com", appVersion: "1.0.14", uiVersion: "1.0.14+1", errors: [item] }), env);

  const list = await (await handleErrorList(new Request("https://w.example/api/errors", { headers: { Authorization: "Bearer t" } }), env)).json();
  assert.equal(list.errors.length, 1);
  assert.equal(list.errors[0].occurrences, 4);
  assert.equal(list.errors[0].message, "boom");
});

test("ignores entries without a fingerprint and an empty list", async () => {
  const none = await (await handleErrorReport(post({ email: "heather@example.com", errors: [] }), env)).json();
  assert.equal(none.stored, 0);
  const missing = await (await handleErrorReport(post({ email: "heather@example.com", errors: [{ message: "x" }] }), env)).json();
  assert.equal(missing.stored, 0);
});
