import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

const output = await build({
  entryPoints: [path.resolve("src/lib/pageViewState.js")], bundle: true, write: false,
  platform: "node", format: "cjs"
});
const module = {exports: {}};
new Function("module", "exports", output.outputFiles[0].text)(module, module.exports);
const {pageViewKey, readPageView, writePageView} = module.exports;

function fixture(run) {
  const original = globalThis.window;
  const data = new Map();
  const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
  globalThis.window = {localStorage: storage};
  try { run(storage); } finally { globalThis.window = original; }
}

test("views survive remount reads and stay isolated by user, screen and report", () => fixture(storage => {
  storage.setItem("enquote_local_session_email", " Alice@example.com ");
  const key = pageViewKey("quotes", "search");
  writePageView(key, "001234");
  assert.equal(readPageView(pageViewKey("quotes", "search"), ""), "001234");
  assert.equal(readPageView(pageViewKey("products", "search"), ""), "");
  writePageView(pageViewKey("report:escalations", "search"), "urgent");
  assert.equal(readPageView(pageViewKey("report:care", "search"), ""), "");
  storage.setItem("enquote_local_session_email", "bob@example.com");
  assert.equal(readPageView(pageViewKey("quotes", "search"), ""), "");
  storage.setItem("enquote_local_session_email", "alice@example.com");
  assert.equal(readPageView(pageViewKey("quotes", "search"), ""), "001234");
}));

test("all Workload column selections including empty sets survive serialization", () => fixture(() => {
  const columns = ["O&M Status", "Project Picklist", "Status", "Case Number", "Enlighten Site ID",
    "Case Last Modified By", "Subject", "Case Owner", "Contact Name", "Contact: Email",
    "New_Location", "Contact: Phone", "Date/Time Opened"];
  const filters = Object.fromEntries(columns.map(column => [column, new Set(["001234", "Selected value"])]));
  filters.Status = new Set();
  const key = pageViewKey("workload", "columns");
  writePageView(key, filters);
  const restored = readPageView(key, {});
  assert.deepEqual(restored, filters);
  assert.equal(restored["Case Number"].has("001234"), true);
  assert.equal(restored.Status.size, 0);
  writePageView(key, {});
  assert.deepEqual(readPageView(key, {}), {});
}));

test("invalid saved shapes and corrupt data are logged and use defaults", () => fixture(storage => {
  const warnings = [], original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    for (const [raw, fallback] of [["{broken", ""], ['"false"', false], ["[]", {}],
      ['{"Status":["submitted"]}', {}], ['{"Status":{"type":"selected-values","values":[42]}}', {}]]) {
      storage.setItem("bad", raw);
      assert.deepEqual(readPageView("bad", fallback), fallback);
    }
    assert.equal(warnings.length, 5);
  } finally { console.warn = original; }
}));

test("storage failure is explicit and does not prevent view changes", () => {
  const original = globalThis.window, originalWarn = console.warn;
  const warnings = [];
  globalThis.window = {localStorage: {getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }}};
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(readPageView("key", false), false);
    assert.doesNotThrow(() => writePageView("key", true));
    assert.equal(warnings.length, 2);
  } finally {
    globalThis.window = original;
    console.warn = originalWarn;
  }
});
