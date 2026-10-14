import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function loadStore() {
  const output = await build({
    entryPoints: [path.join("src", "features", "supervisorDashboard", "hygieneHistoryStore.js")],
    bundle: true, write: false, platform: "node", format: "esm",
    alias: {"@": path.resolve("src")}
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}

function installWindow(collections) {
  const storage = new Map();
  globalThis.window = {
    enquoteLocal: collections ? {collections} : undefined,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    }
  };
  return storage;
}

const table = importedAt => ({
  importedAt, columns: ["Case Number", "Case Comment", "Case Comment Created By"],
  rows: [{"Case Number": "1", "Case Comment": "O&M_QUOTE", "Case Comment Created By": "Ann"}]
});

test("hygiene history falls back to browser storage until the desktop app is restarted", async () => {
  const unsupported = () => Promise.reject(new Error("Error invoking remote method 'collections:list': Error: Unsupported local collection: quoteRequestHygieneDaily"));
  const storage = installWindow({list: unsupported, create: unsupported, update: unsupported});
  const store = await loadStore();
  assert.deepEqual(await store.listHygieneHistory(), []);
  assert.equal(await store.recordHygieneSnapshot(table("2026-10-13T15:00:00")), true);
  const saved = await store.listHygieneHistory();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, "hygiene:2026-10-13");
  assert.equal(storage.size, 1);

  // After a restart the collection exists: browser-stored days move into it.
  const collection = [];
  globalThis.window.enquoteLocal.collections = {
    list: async () => [...collection],
    create: async (_name, record) => { collection.push(record); return record; },
    update: async (_name, id, record) => { collection.splice(collection.findIndex(item => item.id === id), 1, record); return record; }
  };
  const migrated = await store.listHygieneHistory();
  assert.deepEqual(migrated.map(record => record.id), ["hygiene:2026-10-13"]);
  assert.equal(collection.length, 1);
  assert.equal(storage.size, 0, "Browser fallback is cleared after migrating");
});

test("other collection errors are still reported", async () => {
  installWindow({list: () => Promise.reject(new Error("disk full"))});
  const store = await loadStore();
  await assert.rejects(store.listHygieneHistory(), /disk full/);
});
