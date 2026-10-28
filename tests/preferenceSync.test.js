import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreferenceSync, isSyncedPreferenceKey, preferenceIdForStorageKey } from "../src/lib/preferenceSync.js";

const email = "agent@example.com";
const theme = `enquote_selected_theme_v1::${email}`;

function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem(key, value) { items.set(String(key), String(value)); },
    removeItem(key) { items.delete(String(key)); },
    items
  };
}

function fakeServer() {
  const rows = new Map();
  let clock = 0;
  return {
    rows,
    async list(since) {
      const after = Number(since || 0);
      const preferences = [...rows.entries()]
        .filter(([, row]) => row.synced > after)
        .map(([key, row]) => ({ key, updatedAt: row.updatedAt, deleted: row.value === null, value: row.value }));
      return { ok: true, preferences, cursor: String(clock) };
    },
    async save(entries) {
      for (const entry of entries) {
        const existing = rows.get(entry.key);
        if (existing && !(entry.updatedAt > existing.updatedAt)) continue;
        rows.set(entry.key, { updatedAt: entry.updatedAt, value: entry.value ?? null, synced: ++clock });
      }
      return { ok: true };
    }
  };
}

function client(storage, server, { isDesktop = false, now = () => Date.parse("2026-10-28T12:00:00Z") } = {}) {
  const applied = [];
  const sync = createPreferenceSync({
    storage, transport: server, isDesktop, now, getEmail: () => email,
    setTimer: () => 0, clearTimer: () => {}, onApplied: (keys) => applied.push(...keys), logger: { warn() {} }
  });
  return { sync, applied };
}

test("only allowlisted settings are synced and search boxes stay local", () => {
  assert.equal(isSyncedPreferenceKey("enquote_selected_theme_v1"), true);
  assert.equal(isSyncedPreferenceKey("enquote_view_v1:quotes:status"), true);
  assert.equal(isSyncedPreferenceKey("enquote_view_v1:quotes:search"), false);
  assert.equal(isSyncedPreferenceKey("enquote_report_table_hidden_columns_"), false);
  assert.equal(isSyncedPreferenceKey("enquote_session_token"), false);
  assert.equal(preferenceIdForStorageKey(theme, email), "enquote_selected_theme_v1");
  assert.equal(preferenceIdForStorageKey(`enquote_selected_theme_v1::other@example.com`, email), null);
  assert.equal(preferenceIdForStorageKey("enquote_sidebar_collapsed", email), "enquote_sidebar_collapsed");
  assert.equal(preferenceIdForStorageKey(`enquote_sidebar_collapsed::${email}`, email), null);
});

test("existing desktop settings win over existing browser settings on first sync", async () => {
  const server = fakeServer();
  const desktop = client(fakeStorage({ [theme]: "midnight", "enquote_draft::x": "keep local" }), server, { isDesktop: true });
  const browserStorage = fakeStorage({ [theme]: "light" });
  const browser = client(browserStorage, server);

  await browser.sync.start();
  await desktop.sync.start();
  assert.equal(server.rows.get("enquote_selected_theme_v1").value, "midnight");
  assert.equal(server.rows.has("enquote_draft"), false);

  await browser.sync.sync();
  assert.equal(browserStorage.getItem(theme), "midnight");
  assert.deepEqual(browser.applied, ["enquote_selected_theme_v1"]);
});

test("a browser with no saved settings adopts the desktop seed", async () => {
  const server = fakeServer();
  await client(fakeStorage({ [theme]: "midnight" }), server, { isDesktop: true }).sync.start();
  const browserStorage = fakeStorage();
  await client(browserStorage, server).sync.start();
  assert.equal(browserStorage.getItem(theme), "midnight");
});

test("newer changes win in both directions, deletions propagate, and unchanged writes are not pushed", async () => {
  const server = fakeServer();
  let time = Date.parse("2026-10-28T12:00:00Z");
  const now = () => time;
  const desktopStorage = fakeStorage();
  const browserStorage = fakeStorage();
  const desktop = client(desktopStorage, server, { isDesktop: true, now });
  const browser = client(browserStorage, server, { now });
  await desktop.sync.start();
  await browser.sync.start();

  desktopStorage.setItem(theme, "ocean");
  await desktop.sync.sync();
  await browser.sync.sync();
  assert.equal(browserStorage.getItem(theme), "ocean");

  time += 1000;
  browserStorage.setItem(theme, "sunset");
  await browser.sync.sync();
  await desktop.sync.sync();
  assert.equal(desktopStorage.getItem(theme), "sunset");

  const synced = server.rows.get("enquote_selected_theme_v1").synced;
  desktopStorage.setItem(theme, "sunset");
  await desktop.sync.sync();
  assert.equal(server.rows.get("enquote_selected_theme_v1").synced, synced);

  time += 1000;
  desktopStorage.removeItem(theme);
  await desktop.sync.sync();
  await browser.sync.sync();
  assert.equal(browserStorage.getItem(theme), null);
});

test("an older remote value is ignored and the newer local change is pushed", async () => {
  const server = fakeServer();
  server.rows.set("enquote_selected_theme_v1", { updatedAt: "2026-01-01T00:00:00.000Z", value: "old", synced: 0 });
  const storage = fakeStorage();
  const local = client(storage, server, { now: () => Date.parse("2026-10-28T12:00:00Z") });
  storage.setItem(theme, "new");
  await local.sync.start();
  assert.equal(storage.getItem(theme), "new");
  assert.equal(server.rows.get("enquote_selected_theme_v1").value, "new");
});

test("remote entries outside the allowlist are never written locally", async () => {
  const storage = fakeStorage({ "enquote_session_token": "secret" });
  const transport = {
    list: async () => ({ ok: true, cursor: "1", preferences: [
      { key: "enquote_session_token", updatedAt: "2026-10-28T12:00:00.000Z", value: "forged" },
      { key: "enquote_view_v1:quotes:search", updatedAt: "2026-10-28T12:00:00.000Z", value: "x" }
    ] }),
    save: async () => ({ ok: true })
  };
  await client(storage, transport).sync.start();
  assert.equal(storage.getItem("enquote_session_token"), "secret");
  assert.equal(storage.getItem(`enquote_view_v1:quotes:search::${email}`), null);
});

test("failed saves keep changes pending for the next attempt", async () => {
  const server = fakeServer();
  let fail = true;
  const transport = { list: server.list, save: async (entries) => (fail ? { ok: false, error: "offline" } : server.save(entries)) };
  const storage = fakeStorage();
  const local = client(storage, transport);
  await local.sync.start();
  storage.setItem(theme, "ocean");
  assert.equal((await local.sync.sync()).ok, false);
  fail = false;
  assert.equal((await local.sync.sync()).ok, true);
  assert.equal(server.rows.get("enquote_selected_theme_v1").value, "ocean");
});
