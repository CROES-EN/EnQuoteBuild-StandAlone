import assert from "node:assert/strict";
import { test } from "node:test";
import { workerAdapter, fetchWorkerSnapshot, invalidateWorkerSnapshot } from "../src/api/adapters/workerAdapter.js";
import { installBrowserBridge } from "../src/api/browserBridge.js";

const snapshot = id => ({ ok: true, quotes: [{ id }], products: [], entities: { Quote: [{ id }] } });
const response = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

test("browser snapshot requests coalesce and invalidated in-flight results cannot refill the cache", async t => {
  invalidateWorkerSnapshot();
  const pending = [];
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => pending.push(resolve)));
  const first = fetchWorkerSnapshot();
  const coalesced = fetchWorkerSnapshot();
  assert.equal(pending.length, 1);
  invalidateWorkerSnapshot();
  const current = fetchWorkerSnapshot();
  pending[1](response(snapshot("new")));
  assert.equal((await current).quotes[0].id, "new");
  pending[0](response(snapshot("old")));
  assert.equal((await first).quotes[0].id, "old");
  await coalesced;
  assert.equal((await fetchWorkerSnapshot()).quotes[0].id, "new");
  assert.equal(pending.length, 2);
});

test("browser mutations send concurrency baselines and require a confirmed saved record", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body), credentials: options.credentials });
    return response({ ok: true, record: { id: "confirmed", status: "submitted" } });
  });
  const saved = await workerAdapter.updateQuote("confirmed", { status: "submitted" }, "version-1");
  assert.equal(saved.id, "confirmed");
  assert.deepEqual(calls[0], {
    path: "/api/web-entities", credentials: "same-origin",
    body: { entityType: "Quote", action: "update", record: { id: "confirmed", status: "submitted" }, expectedVersion: "version-1" }
  });
  t.mock.method(globalThis, "fetch", async () => response({ ok: true }));
  await assert.rejects(workerAdapter.createProduct({ name: "Product" }), /did not confirm/);
});

test("browser reports use versioned cached records and RMAs use the desktop shared store", async t => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => null };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  });
  t.mock.method(globalThis, "setInterval", () => 0);
  t.mock.method(globalThis, "setTimeout", () => 0);
  const reads = [];
  t.mock.method(globalThis, "fetch", async path => {
    const url = new URL(path, "https://browser.example");
    reads.push(url.pathname + url.search);
    if (url.pathname === "/api/browser/supervisor/index") return response({ ok: true, records: [
      { collection: "supervisorReportTables", id: "care_subscriptions", updatedAt: "v1", deleted: false },
      { collection: "supervisorReportTables", id: "small-report", updatedAt: "v1", deleted: false },
      { collection: "rmas", id: "shared-rma", updatedAt: "v1", deleted: false }
    ] });
    if (url.pathname === "/api/browser/supervisor/record") return response({
      ok: true, record: { id: url.searchParams.get("id"), rows: [] }, deleted: false
    });
    if (url.pathname === "/api/browser/sops/files/test-file") return new Response(new Uint8Array([37, 80, 68, 70]), {
      headers: { "Content-Type": "application/pdf" }
    });
    throw new Error(`Unexpected browser request: ${path}`);
  });
  installBrowserBridge();
  const bridge = globalThis.window.enquoteLocal;
  assert.deepEqual((await bridge.collections.list("supervisorReportTables")).map(item => item.id), ["small-report"]);
  await bridge.collections.list("supervisorReportTables");
  assert.equal(reads.filter(path => path.includes("/record")).length, 1);
  assert.equal((await bridge.largeTables.get("care_subscriptions")).id, "care_subscriptions");
  assert.equal((await workerAdapter.listLocalCollection("rmas"))[0].id, "shared-rma");
  assert.equal(reads.filter(path => path.includes("/index")).length, 1);
  assert.equal(reads.filter(path => path.includes("/record")).length, 3);
  const file = await bridge.sops.getFile("test-file");
  assert.equal(file.ok, true);
  assert.equal(file.type, "application/pdf");
  assert.deepEqual([...file.bytes], [37, 80, 68, 70]);
});
