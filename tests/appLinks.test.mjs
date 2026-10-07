import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {APP_LINK_QUERY, appLinkUrl, validAppLink} from "../shared/appLinkRules.js";
import {readSharedDashboardPeriod, sharedDashboardTilePath, SHARED_PERIOD_QUERY} from "../src/features/supervisorDashboard/sharedDashboardPeriod.js";
import {readReportingPeriod, saveReportingPeriod} from "../src/features/supervisorDashboard/reportingPeriodPreferences.js";

const require = createRequire(import.meta.url);
const attachment = {type: "app_link", label: "Quote Q-123", path: "/QuoteDetails?id=123", target: {kind: "record", value: "quote:123"}};

async function loadSelection() {
  const result = await build({
    entryPoints: [path.resolve("src\\features\\collab\\appLinkSelection.js")],
    bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("shared links preserve local routes and filters and reject external URLs, secrets, and executable selectors", () => {
  const url = appLinkUrl(attachment);
  const parsed = new URL(url, "https://local.invalid");
  assert.equal(parsed.pathname, "/QuoteDetails");
  assert.equal(parsed.searchParams.get("id"), "123");
  assert.deepEqual(JSON.parse(parsed.searchParams.get(APP_LINK_QUERY)), attachment.target);
  for (const path of ["https://example.com", "//example.com", "javascript:alert(1)", "/\\example.com", "/Quotes#external", "/Quotes?token=secret", "/Quotes?password=secret", "/Quotes\u0000", "/Quotes?name=a\n"]) {
    assert.equal(validAppLink({...attachment, path}), false, path);
  }
  for (const target of [{kind: "selector", value: "script"}, {kind: "text", tag: "script", value: "x"}, {kind: "record", value: ""}]) {
    assert.equal(validAppLink({...attachment, target}), false);
  }
  assert.equal(validAppLink(attachment), true);
});

test("highlight lasts exactly five seconds and cleans up safely on navigation", async () => {
  const {glowSharedElement, findAppElement} = await loadSelection();
  const classes = new Set();
  let callback, delay, cleared = false, scrolled = false;
  const element = {classList: {add: value => classes.add(value), remove: value => classes.delete(value)}, scrollIntoView: () => {scrolled = true;}};
  const cleanup = glowSharedElement(element, {setTimer: (fn, ms) => {callback = fn; delay = ms; return 123;}, clearTimer: id => {cleared = id === 123;}});
  assert.equal(delay, 5000);
  assert.equal(scrolled, true);
  assert.equal(classes.has("enquote-shared-target"), true);
  callback();
  assert.equal(classes.has("enquote-shared-target"), false);
  cleanup();
  assert.equal(cleared, true);
  const item = {textContent: "Unique item", getClientRects: () => [{}]};
  const root = {querySelectorAll: () => [item]};
  assert.equal(findAppElement(root, {kind: "text", tag: "p", value: "Unique item"}), item);
  assert.equal(findAppElement({querySelectorAll: () => [item, item]}, {kind: "text", tag: "p", value: "Unique item"}), null,
    "ambiguous matches must not highlight the wrong record");
});

test("Workload cell selection resolves to its complete case row and keeps a stable row target", async () => {
  const {pickAppElement, describeAppElement} = await loadSelection();
  const attributes = {
    "data-enquote-share-target": "workload-case:500123",
    "data-enquote-share-label": "Workload case 1983761"
  };
  const main = {getAttribute: () => null, querySelectorAll: () => [row]};
  const row = {
    tagName: "TR", textContent: "Many workload cells",
    getAttribute: name => attributes[name] || null,
    getClientRects: () => [{}],
    closest: selector => selector === "main" ? main : row
  };
  const cell = {closest: selector => selector.startsWith("[data-enquote-share-target]") ? row : null};
  assert.equal(pickAppElement(cell), row);
  assert.deepEqual(describeAppElement(row, "/Workload"), {
    type: "app_link", label: "Workload case 1983761", path: "/Workload",
    target: {kind: "record", value: "workload-case:500123"}
  });
});

test("dashboard tile links freeze exact reporting dates and mode without changing the recipient preference", () => {
  const storage = new Map([["enquote_local_session_email", "recipient@example.com"]]);
  globalThis.window = {localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  }};
  try {
    const saved = {preset: "single_day", start: "2026-09-01", end: "2026-09-01"};
    saveReportingPeriod("overview", saved);
    for (const preset of ["custom_range", "last_7_days", "all_history", "single_day"]) {
      const range = {preset, start: "2026-10-01", end: preset === "single_day" ? "2026-10-01" : "2026-10-07"};
      const route = sharedDashboardTilePath("handled", range, "daily_average");
      const url = appLinkUrl({
        type: "app_link", label: "Handled", path: route,
        target: {kind: "record", value: "supervisor-tile:handled"}
      });
      const params = new URL(url, "https://local.invalid").searchParams;
      assert.equal(params.get("tab"), "dashboard");
      assert.deepEqual(readSharedDashboardPeriod(params), {range, mode: "daily_average"});
      params.delete(APP_LINK_QUERY);
      assert.deepEqual(readSharedDashboardPeriod(params), {range, mode: "daily_average"},
        "removing the five-second highlight does not revert the reporting period");
      assert.deepEqual(readReportingPeriod("overview"), saved);
    }
    for (const value of [
      "{", JSON.stringify({range: {preset: "custom_range", start: "2026-02-30", end: "2026-03-01"}, mode: "period_total"}),
      JSON.stringify({range: saved, mode: "unknown"}),
      JSON.stringify({range: {...saved, end: "2026-08-01"}, mode: "period_total"})
    ]) {
      assert.throws(() => readSharedDashboardPeriod(new URLSearchParams({[SHARED_PERIOD_QUERY]: value})));
    }
    assert.equal(readSharedDashboardPeriod(new URLSearchParams()), null);
  } finally {delete globalThis.window;}
});

test("nested values resolve to the nearest complete group and Auto-Drafter excludes non-tile controls", async () => {
  const {pickAppElement, describeAppElement} = await loadSelection();
  const main = {getAttribute: () => null, querySelectorAll: () => [group]};
  const group = {
    tagName: "DIV", textContent: "Site ID 123",
    getAttribute: name => ({
      "data-enquote-share-target": "quote:q1:site-id",
      "data-enquote-share-label": "Site ID 123"
    })[name] || null,
    getClientRects: () => [{}],
    closest: selector => selector === "main" ? main : group
  };
  const value = {closest: selector => selector.startsWith("[data-enquote-share-target]") ? group : null};
  assert.equal(pickAppElement(value), group);
  assert.deepEqual(describeAppElement(group, "/QuoteDetails?id=q1"), {
    type: "app_link", label: "Site ID 123", path: "/QuoteDetails?id=q1",
    target: {kind: "record", value: "quote:q1:site-id"}
  });
  const toolbar = {closest: selector => selector === "[data-enquote-share-scope='tiles']" ? {} : null};
  assert.equal(pickAppElement(toolbar), null);
  group.getAttribute = name => ({
    "data-enquote-share-target": "supervisor-tile:handled",
    "data-enquote-share-label": "Handled",
    "data-enquote-share-route": sharedDashboardTilePath("handled",
      {preset: "custom_range", start: "2026-10-01", end: "2026-10-07"}, "period_total")
  })[name] || null;
  const tileLink = describeAppElement(pickAppElement(value), "/SupervisorDashboard");
  assert.equal(tileLink.target.value, "supervisor-tile:handled");
  assert.equal(readSharedDashboardPeriod(new URL(tileLink.path, "https://local.invalid").searchParams).range.end, "2026-10-07");
});

test("quote background shares the page and draft field links inherit the saved quote route", async () => {
  const {pickAppElement, describeAppElement} = await loadSelection();
  const main = {querySelector: () => ({tagName: "H1"})};
  const attributes = {
    "data-enquote-share-target": "quote:q1",
    "data-enquote-share-scope": "groups",
    "data-enquote-share-label": "Quote Q-123"
  };
  const page = {
    getAttribute: name => attributes[name] || null,
    closest: selector => selector === "main" ? main : null
  };
  const background = {closest: selector => selector === "[data-enquote-share-scope='groups']" ? page : null};
  assert.equal(pickAppElement(background), page);
  assert.deepEqual(describeAppElement(page, "/QuoteDetails?id=q1"), {
    type: "app_link", label: "Quote Q-123", path: "/QuoteDetails?id=q1", target: {kind: "page"}
  });
  const route = {getAttribute: () => "/AutoDrafter?draftCase=456"};
  const field = {
    getAttribute: name => name === "data-enquote-share-target" ? "auto-drafter-case:456:site-id" :
      name === "data-enquote-share-label" ? "Site ID 123" : null,
    closest: selector => selector === "main" ? main : selector === "[data-enquote-share-route]" ? route : null
  };
  assert.deepEqual(describeAppElement(field, "/AutoDrafter"), {
    type: "app_link", label: "Site ID 123", path: "/AutoDrafter?draftCase=456",
    target: {kind: "record", value: "auto-drafter-case:456:site-id"}
  });
});

test("quote section labels retain the reference while whole-quote labels remain unchanged", async () => {
  const {describeAppElement} = await loadSelection();
  const context = {
    getAttribute: name => name === "data-enquote-share-quote-number" ? "Q-123" :
      name === "data-enquote-share-target" ? "quote:q1" :
      name === "data-enquote-share-scope" ? "groups" :
      name === "data-enquote-share-label" ? "Quote Q-123" : null,
    closest: selector => selector === "main" ? main :
      selector === "[data-enquote-share-quote-number]" ? context : null
  };
  let label = "Status History";
  const field = {
    getAttribute: name => name === "data-enquote-share-label" ? label :
      name === "data-enquote-share-target" ? "quote:q1:history" : null,
    getClientRects: () => [{}],
    closest: selector => selector === "main" ? main :
      selector === "[data-enquote-share-quote-number]" ? context : null
  };
  const main = {getAttribute: () => null, querySelectorAll: () => [field], querySelector: () => ({})};
  for (label of ["Status History", "Quote Activity", "Follow-Up History", "Notes & Terms", "Scope of Work", "Quote Details", "Line Items", "Site ID 123"]) {
    assert.equal(describeAppElement(field, "/QuoteDetails?id=q1").label, `${label} - Q-123`);
  }
  label = "x".repeat(160);
  const shortened = describeAppElement(field, "/QuoteDetails?id=q1").label;
  assert.equal(shortened.length, 160);
  assert.ok(shortened.endsWith(" - Q-123"));
  label = "Quote Q-123";
  assert.equal(describeAppElement(field, "/QuoteDetails?id=q1").label, label);
  assert.equal(describeAppElement(context, "/QuoteDetails?id=q1").label, label);
  context.getAttribute = name => name === "data-enquote-share-quote-number" ? "AI-456" : null;
  label = "Site ID 123";
  assert.equal(describeAppElement(field, "/QuoteDetails?id=q1").label, "Site ID 123 - AI-456");
});

test("element selection is cancellable and cannot attach an item to another user's session", async () => {
  let owner = "alice@example.com";
  const events = new EventTarget();
  globalThis.window = {
    localStorage: {getItem: () => owner},
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    dispatchEvent: event => events.dispatchEvent(event)
  };
  try {
    const api = await loadSelection();
    const picked = [];
    const cancel = api.startAppLinkSelection(item => picked.push(item));
    assert.equal(api.currentAppLinkRequest().owner, owner);
    cancel();
    assert.equal(api.currentAppLinkRequest(), null);
    api.startAppLinkSelection(item => picked.push(item));
    api.finishAppLinkSelection(attachment);
    assert.deepEqual(picked, [attachment]);
    api.startAppLinkSelection(item => picked.push(item));
    owner = "bob@example.com";
    api.finishAppLinkSelection(attachment);
    assert.equal(picked.length, 1);
  } finally {delete globalThis.window;}
});
