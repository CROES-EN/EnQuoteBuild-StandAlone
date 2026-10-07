import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {localAdapter} from "../src/api/adapters/localAdapter.js";

const require = createRequire(import.meta.url);

test("assigned-task bell notices identify the sender, stay private, and remain cleared after sync", async () => {
  const storage = new Map([["enquote_local_session_email", "recipient@example.com"]]);
  let tasks = [{id: "assigned", title: "Call homeowner", assigned_by: "sender@example.com", created_date: "2026-10-07T20:00:00Z"}];
  globalThis.window = {
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    enquoteLocal: {collections: {list: async () => []}, tasks: {list: async () => tasks}}
  };
  try {
    const api = await loadNotifications();
    const [notice] = await api.listNotifications();
    assert.equal(notice.type, "task_assigned");
    assert.equal(notice.changedBy, "sender@example.com");
    assert.equal(notice.taskId, "assigned");
    await api.markAllRead();
    assert.equal((await api.listNotifications())[0].read, true);
    await api.clearNotification(notice.id);
    tasks = [{...tasks[0], updated_date: "2026-10-08T20:00:00Z", status: "done"}];
    assert.deepEqual(await (await loadNotifications()).listNotifications(), []);
    storage.set("enquote_local_session_email", "sender@example.com");
    assert.deepEqual(await api.listNotifications(), [], "sender never gets their own assignment notice");
    tasks = [];
    storage.set("enquote_local_session_email", "unrelated@example.com");
    assert.deepEqual(await api.listNotifications(), []);
  } finally {delete globalThis.window;}
});

async function loadNotifications() {
  const result = await build({
    entryPoints: [path.join("src", "features", "notifications", "appNotifications.js")],
    bundle: true, write: false, platform: "node", format: "cjs",
    alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("142 cleared notifications stay dismissed through reloads, stale database writes and event replays", async () => {
  const storage = new Map([["enquote_local_session_email", "first@example.com"]]);
  let records = Array.from({length: 142}, (_, i) => ({
    id: `n${i}`, type: "quote_updated", quoteId: `q${i}`, occurredAt: "2026-10-07T16:51:00Z", read: false, seq: i
  }));
  globalThis.window = {
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    enquoteLocal: {collections: {list: async () => records}}
  };
  try {
    const api = await loadNotifications();
    const displayed = await api.listNotifications();
    assert.equal(displayed.length, 142);
    await api.markAllRead();
    assert.ok((await api.listNotifications()).every(item => item.read));
    await api.clearAllNotifications(displayed);
    assert.equal((await api.listNotifications()).length, 0);
    const reloaded = await loadNotifications();
    assert.equal((await reloaded.listNotifications()).length, 0);
    records = records.map(item => ({...item, id: `${item.id}-replayed`, occurredAt: "2026-10-07T16:51:00.000000", read: false}));
    assert.equal((await reloaded.listNotifications()).length, 0);
    records.push({id: "new", type: "quote_updated", quoteId: "q1", occurredAt: "2026-10-07T17:00:00Z", read: false});
    assert.deepEqual((await reloaded.listNotifications()).map(item => item.id), ["new"]);
    await api.clearNotification("new");
    assert.equal((await api.listNotifications()).length, 0);
    storage.set("enquote_local_session_email", "second@example.com");
    assert.equal((await api.listNotifications()).length, 143);
    assert.ok((await api.listNotifications()).every(item => !item.read));
  } finally {
    delete globalThis.window;
  }
});

test("clear-all preserves later arrivals and storage failures reject without hiding records", async () => {
  const storage = new Map([["enquote_local_session_email", "first@example.com"]]);
  const records = [{id: "old", type: "quote_updated", quoteId: "q", occurredAt: "2026-10-07T16:00:00Z"}];
  let fail = false;
  globalThis.window = {
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => {
      if (fail) throw new Error("Storage full");
      storage.set(key, value);
    }},
    enquoteLocal: {collections: {list: async () => records}}
  };
  try {
    const api = await loadNotifications();
    const displayed = await api.listNotifications();
    records.push({id: "later", type: "quote_updated", quoteId: "q", occurredAt: "2026-10-07T17:00:00Z"});
    await api.clearAllNotifications(displayed);
    assert.deepEqual((await api.listNotifications()).map(item => item.id), ["later"]);
    fail = true;
    await assert.rejects(api.clearAllNotifications(), /Storage full/);
    await assert.rejects(api.markAllRead(), /Storage full/);
    assert.deepEqual((await api.listNotifications()).map(item => item.id), ["later"]);
  } finally {
    delete globalThis.window;
  }
});

test("local quote callers use verified email and never fall back to a demo identity", async () => {
  globalThis.window = {
    localStorage: {getItem: () => "stale@example.com"},
    enquoteLocal: {
      auth: {getVerifiedIdentity: async () => ({email: " Signed.In@Example.com "})},
      collections: {list: async () => [{email: "signed.in@example.com", full_name: "Signed In", app_role: "submitter"}]}
    }
  };
  try {
    const user = await localAdapter.getCurrentUser();
    assert.equal(user.email, "signed.in@example.com");
    window.enquoteLocal.auth.getVerifiedIdentity = async () => null;
    await assert.rejects(localAdapter.getCurrentUser(), /Verified Cloudflare identity/);
    delete window.enquoteLocal.auth;
    window.localStorage.getItem = () => null;
    await assert.rejects(localAdapter.getCurrentUser(), /Signed-in identity/);
  } finally {
    delete globalThis.window;
  }
});

test("duplicates appear once, shared read flags never leak, and an upgrade preserves prior dismissals", async () => {
  const storage = new Map([["enquote_local_session_email", "first@example.com"]]);
  let records = [
    {id: "one", type: "quote_updated", quoteId: "q", occurredAt: "2026-10-07T16:00:00Z", read: true, seq: 1},
    {id: "two", type: "quote_updated", quoteId: "q", occurredAt: "2026-10-07T16:00:00.000000", read: true, seq: 2}
  ];
  globalThis.window = {
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    enquoteLocal: {collections: {list: async () => records}}
  };
  try {
    const api = await loadNotifications();
    assert.deepEqual((await api.listNotifications()).map(item => [item.id, item.read]), [["two", false]]);
    await api.clearAllNotifications();
    records = records.map(item => ({...item, id: `${item.id}-new`, eventId: "stable-event"}));
    assert.equal((await api.listNotifications()).length, 0);
    storage.set("enquote_local_session_email", "second@example.com");
    assert.equal((await api.listNotifications()).length, 1);
    await api.markAllRead();
    assert.equal((await api.listNotifications())[0].read, true);
    storage.set("enquote_local_session_email", "third@example.com");
    assert.equal((await api.listNotifications())[0].read, false);
    storage.delete("enquote_local_session_email");
    assert.equal((await api.listNotifications()).length, 0);
  } finally {
    delete globalThis.window;
  }
});
