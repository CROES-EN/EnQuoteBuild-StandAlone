import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function loadSidebarOrder() {
  const output = await build({
    entryPoints: [path.resolve("src/lib/sidebarOrder.js")], bundle: true, write: false,
    platform: "node", format: "cjs", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("module", "exports", output.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test("sidebar order is saved separately for each signed-in user", async () => {
  const {readSidebarOrder, writeSidebarOrder} = await loadSidebarOrder();
  const storage = memoryStorage();
  const previous = globalThis.window;
  globalThis.window = {localStorage: storage};
  try {
    storage.setItem("enquote_local_session_email", "Alice@Enphaseenergy.com");
    writeSidebarOrder(["Tasks", "Quotes"], storage);
    storage.setItem("enquote_local_session_email", "bob@enphaseenergy.com");
    assert.equal(readSidebarOrder(storage), null);
    writeSidebarOrder(["Workload"], storage);
    storage.setItem("enquote_local_session_email", "alice@enphaseenergy.com");
    assert.deepEqual(readSidebarOrder(storage), ["Tasks", "Quotes"]);
    writeSidebarOrder(null, storage);
    assert.equal(readSidebarOrder(storage), null);
    storage.setItem("enquote_local_session_email", "bob@enphaseenergy.com");
    assert.deepEqual(readSidebarOrder(storage), ["Workload"]);
  } finally {
    globalThis.window = previous;
  }
});

test("the old per-computer order moves to the first signed-in user only", async () => {
  const {readSidebarOrder} = await loadSidebarOrder();
  const storage = memoryStorage({enquote_sidebar_order: JSON.stringify(["Quotes", "Tasks"])});
  const previous = globalThis.window;
  globalThis.window = {localStorage: storage};
  try {
    assert.equal(readSidebarOrder(storage), null, "signed-out sessions do not claim it");
    assert.ok(storage.values.has("enquote_sidebar_order"));
    storage.setItem("enquote_local_session_email", "alice@enphaseenergy.com");
    assert.deepEqual(readSidebarOrder(storage), ["Quotes", "Tasks"]);
    assert.ok(!storage.values.has("enquote_sidebar_order"));
    storage.setItem("enquote_local_session_email", "bob@enphaseenergy.com");
    assert.equal(readSidebarOrder(storage), null);
  } finally {
    globalThis.window = previous;
  }
});

test("pages missing from a saved order keep their default position after saved pages", async () => {
  const {applySidebarOrder} = await loadSidebarOrder();
  const items = ["A", "B", "C", "D"].map(page => ({page}));
  assert.deepEqual(applySidebarOrder(items, ["C", "A"]).map(item => item.page), ["C", "A", "B", "D"]);
});
