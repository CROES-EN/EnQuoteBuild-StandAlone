import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function bundle(entry) {
  const output = await build({
    entryPoints: [path.join("src", "features", "quoteDraftAgent", entry)],
    bundle: true, write: false, platform: "node", format: "esm",
    alias: {"@": path.resolve("src")}
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}

const kb = await bundle("enphaseKnowledgeBase.js");

test("reference entries match common line item names and SKUs", () => {
  const id = (name, sku) => kb.findEnphaseProduct(name, sku)?.id || null;
  assert.equal(id("Enphase IQ8M Microinverter"), "iq8m");
  assert.equal(id("IQ8 Microinverter (60-cell)"), "iq8");
  assert.equal(id("IQ8+ Microinverter"), "iq8plus");
  assert.equal(id("IQ8 Plus micro"), "iq8plus");
  assert.equal(id("IQ8H-208 Microinverter"), "iq8h-208");
  assert.equal(id("IQ8H Microinverter"), "iq8h-240");
  assert.equal(id("IQ7A Microinverter"), "iq7a");
  assert.equal(id("IQ7 Microinverter"), "iq7");
  assert.equal(id("Replacement micro", "IQ8X-80-M-US"), "iq8x");
  assert.equal(id("Q-TERM-10 terminator"), "q-term-10");
  assert.equal(id("Rail bolts"), null);
  assert.match(kb.enphaseSpecSummary(kb.findEnphaseProduct("IQ8M")), /max 11 per 20 A branch/);
  assert.ok(kb.enphaseSource(kb.findEnphaseProduct("IQ8M")).url.startsWith("https://"));
});

test("spec checks cite the data sheet for branch limits and IQ7/IQ8 mixing", () => {
  const branch = kb.enphaseSpecChecks([{name: "IQ8M Microinverter", quantity: 32, confidence: "high"}]);
  assert.equal(branch.length, 1);
  assert.match(branch[0].reason, /at most 11 .*32 units need at least 3 branch circuits/);
  assert.ok(branch[0].source?.url);
  assert.deepEqual(kb.enphaseSpecChecks([{name: "IQ8M Microinverter", quantity: 11}]), []);

  const intoIq7 = kb.enphaseSpecChecks([{name: "IQ8+ Microinverter", quantity: 2}], "Site has IQ7+ micros, 2 failed");
  assert.ok(intoIq7.some((check) => check.id === "mix:iq8-into-iq7"));
  const intoIq8 = kb.enphaseSpecChecks([{name: "IQ7 Microinverter", quantity: 1}], "Existing IQ8 array");
  assert.ok(intoIq8.some((check) => check.id === "mix:iq7-into-iq8"));
});

test("unpriced Enphase products are flagged and searchable as references", () => {
  const checks = kb.enphaseSpecChecks([{name: "IQ Disconnect Tool", quantity: 1, confidence: "low"}]);
  assert.ok(checks.some((check) => check.id.startsWith("reference:q-disc-10") && /Add product/.test(check.reason)));
  const results = kb.searchEnphaseReference("disconnect");
  assert.equal(results[0].id, "q-disc-10");
  assert.equal(kb.catalogItemForEnphaseProduct(results[0]), null);
  assert.deepEqual(kb.searchEnphaseReference(""), []);
});

test("reviewer-added products join the catalog without overriding built-in items", async () => {
  const catalog = await bundle("productCatalog.js");
  const builtIn = catalog.PRODUCT_CATALOG.find((item) => item.category === "Wiring & Cable Management");
  const before = catalog.PRODUCT_CATALOG.length;
  catalog.setRuntimeCustomProducts([
    {name: "IQ Disconnect Tool", sku: "Q-DISC-10", category: "Wiring & Cable Management", unit_price: 12.5, unit: "each"},
    {name: builtIn.name, category: "Wiring & Cable Management", unit_price: 999}
  ]);
  const added = catalog.PRODUCT_CATALOG.filter((item) => item.custom);
  assert.equal(added.length, 1);
  assert.equal(added[0].name, "IQ Disconnect Tool");
  assert.equal(added[0].unit_price, 12.5);
  assert.equal(added[0].tax_code, builtIn.tax_code);
  assert.equal(catalog.PRODUCT_CATALOG.find((item) => item.name === builtIn.name).unit_price, builtIn.unit_price);

  catalog.setRuntimeCustomProducts([{name: "IQ Disconnect Tool", category: "Wiring & Cable Management", unit_price: 14, unit: "each"}]);
  assert.equal(catalog.PRODUCT_CATALOG.length, before + 1);
  assert.equal(catalog.PRODUCT_CATALOG.find((item) => item.custom).unit_price, 14);
  catalog.setRuntimeCustomProducts([]);
  assert.equal(catalog.PRODUCT_CATALOG.length, before);
});

test("custom products persist in browser storage until the collection is available", async () => {
  const storage = new Map();
  const unsupported = async () => { throw new Error("Unsupported local collection: autoDrafterCustomProducts"); };
  globalThis.window = {
    enquoteLocal: {collections: {list: unsupported, create: unsupported, update: unsupported, delete: unsupported}},
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    }
  };
  try {
    const store = await bundle("customProductsStore.js");
    assert.match(store.validateCustomProduct({name: "", unit_price: 1, category: "x"}), /name/);
    assert.match(store.validateCustomProduct({name: "Thing", unit_price: 0, category: "x"}), /price/);
    const saved = await store.saveCustomProduct({name: "IQ Disconnect Tool", sku: "Q-DISC-10", category: "Wiring & Cable Management", unit_price: "12.499"});
    assert.equal(saved.unit_price, 12.5);
    assert.equal(saved.custom, true);
    assert.equal((await store.listCustomProducts()).length, 1);
    await store.removeCustomProduct("IQ Disconnect Tool");
    assert.equal((await store.listCustomProducts()).length, 0);
    assert.equal(storage.size, 0);
  } finally {
    delete globalThis.window;
  }
});

test("custom products saved before a restart move into the collection afterwards", async () => {
  const records = new Map();
  const storage = new Map([["enquote_autodrafter_custom_products_v1", JSON.stringify([{id: "product:iq disconnect tool", name: "IQ Disconnect Tool", category: "Wiring & Cable Management", unit_price: 12.5, unit: "each"}])]]);
  globalThis.window = {
    enquoteLocal: {collections: {
      list: async () => [...records.values()],
      create: async (_name, record) => { records.set(record.id, record); return record; },
      update: async (_name, id, record) => { records.set(id, record); return record; },
      delete: async (_name, id) => { records.delete(id); }
    }},
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    }
  };
  try {
    const store = await bundle("customProductsStore.js");
    assert.equal((await store.loadCustomProducts()).length, 1);
    assert.equal(records.size, 1);
    assert.equal(storage.size, 0);
  } finally {
    delete globalThis.window;
  }
});
