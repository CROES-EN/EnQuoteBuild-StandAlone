import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";
import {canAccessPage} from "../electron/pageAccess.mjs";

const output = await build({
  entryPoints: [path.resolve("src/lib/appPreferences.js")], bundle: true, write: false,
  platform: "node", format: "cjs"
});
const module = {exports: {}};
new Function("module", "exports", output.outputFiles[0].text)(module, module.exports);
const {readAppPreferences, writeAppPreferences, filterSidebarItems, normalizeAppPreferences} = module.exports;

test("personal settings persist across reloads without leaking to another user", () => {
  const data = new Map();
  const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
  const originalWindow = globalThis.window;
  let notifications = 0;
  globalThis.window = {localStorage: storage, dispatchEvent: () => notifications++};
  try {
    storage.setItem("enquote_local_session_email", "alice@example.com");
    writeAppPreferences({salesforceMode: "external", showSalesforceLauncher: false, hiddenPages: ["Quotes"]}, storage);
    assert.deepEqual(readAppPreferences(storage), {
      salesforceMode: "external", showSalesforceLauncher: false, salesforcePanelExpanded: true, salesforcePanelWidth: 960, hiddenPages: ["Quotes"]
    });
    storage.setItem("enquote_local_session_email", "bob@example.com");
    assert.deepEqual(readAppPreferences(storage), normalizeAppPreferences(null));
    storage.setItem("enquote_local_session_email", "alice@example.com");
    assert.deepEqual(readAppPreferences(storage).hiddenPages, ["Quotes"]);
    assert.equal(notifications, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Salesforce panel widths are remembered per user and constrained to supported values", () => {
  assert.equal(normalizeAppPreferences(null).salesforcePanelExpanded, true);
  assert.equal(normalizeAppPreferences({salesforcePanelExpanded: false}).salesforcePanelExpanded, false);
  assert.equal(normalizeAppPreferences({salesforcePanelWidth: 800}).salesforcePanelWidth, 800);
  assert.equal(normalizeAppPreferences({salesforcePanelWidth: 200}).salesforcePanelWidth, 320);
  assert.equal(normalizeAppPreferences({salesforcePanelWidth: 9999}).salesforcePanelWidth, 1600);
  assert.equal(normalizeAppPreferences({salesforcePanelWidth: "800"}).salesforcePanelWidth, 960);
});
test("Settings cannot be hidden and sidebar filtering preserves order", () => {
  const preferences = normalizeAppPreferences({hiddenPages: ["Quotes", "Settings", "Quotes", 10]});
  assert.deepEqual(preferences.hiddenPages, ["Quotes"]);
  assert.deepEqual(filterSidebarItems(["Workload", "Quotes", "Settings", "Tasks"].map(page => ({page})), preferences)
    .map(item => item.page), ["Workload", "Settings", "Tasks"]);
});

test("settings persistence failures are explicit", () => {
  assert.throws(() => writeAppPreferences({}, {setItem() { throw new Error("Disk full"); }}), /Disk full/);
});

test("all assigned roles can reach Settings even with an existing custom role policy", () => {
  for (const role of ["submitter", "invoicer", "approver", "admin"]) {
    assert.equal(canAccessPage({app_role: role}, "Settings", {rolePages: {[role]: []}}), true);
  }
  assert.equal(canAccessPage({app_role: "submitter", deny_pages: ["Settings"]}, "Settings"), false);
  assert.equal(canAccessPage({}, "Settings"), false);
});
