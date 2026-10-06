const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createTasksSync, isReminderDue } = require("../../electron/tasksSync.cjs");
const { createSopLibrary } = require("../../electron/sopLibrary.cjs");
const { createChatService } = require("../../electron/chatService.cjs");
const { createCollabClient } = require("../../electron/collabClient.cjs");

const quietLogger = { warn() {}, info() {}, error() {} };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "enquote-collab-"));
}

// In-memory stand-in for the Worker's task endpoints (LWW on updatedAt, synced_at cursor).
function fakeTaskServer() {
  const rows = new Map();
  let clock = Date.parse("2030-01-01T00:00:00.000Z");
  const calls = [];
  const client = {
    ready: true,
    isReady() { return this.ready; },
    async get(route, params) {
      calls.push(["GET", route, params]);
      const since = params.since || "";
      const list = [...rows.values()].filter((row) => row.syncedAt > since).sort((a, b) => a.syncedAt.localeCompare(b.syncedAt));
      return { ok: true, tasks: list.map(({ id, updatedAt, deleted, record }) => ({ id, updatedAt, deleted, record })), cursor: list.at(-1)?.syncedAt || since };
    },
    async post(route, body) {
      calls.push(["POST", route, body]);
      const existing = rows.get(body.id);
      const stamp = body.updatedAt || body.deletedAt;
      if (existing && existing.updatedAt >= stamp) return { ok: true, applied: false };
      clock += 1000;
      rows.set(body.id, {
        id: body.id,
        updatedAt: stamp,
        syncedAt: new Date(clock).toISOString(),
        deleted: route.endsWith("/delete"),
        record: route.endsWith("/delete") ? null : body.record
      });
      return { ok: true, applied: true };
    }
  };
  return { client, rows, calls };
}

test("tasks are saved locally, pushed, and pulled onto a second PC", async () => {
  const server = fakeTaskServer();
  let nowMs = Date.parse("2030-01-01T09:00:00.000Z");
  const pcA = createTasksSync({ client: server.client, getEmail: () => "A@x.com", storageDir: tempDir(), logger: quietLogger, now: () => nowMs });
  const saved = pcA.save({ title: "Call homeowner", type: "call", due_at: "2030-01-02T15:00:00.000Z", remind_at: "2030-01-02T14:45:00.000Z" });
  assert.equal(pcA.list().length, 1);
  await pcA.sync();
  assert.equal(server.rows.get(saved.id).record.title, "Call homeowner");

  const pcB = createTasksSync({ client: server.client, getEmail: () => "a@x.com", storageDir: tempDir(), logger: quietLogger, now: () => nowMs });
  await pcB.sync();
  assert.equal(pcB.list()[0].title, "Call homeowner");

  nowMs += 60_000;
  pcB.save({ ...pcB.list()[0], status: "done" });
  await pcB.sync();
  await pcA.sync();
  assert.equal(pcA.list()[0].status, "done");
  assert.ok(pcA.list()[0].completed_at);

  pcA.remove(saved.id);
  await pcA.sync();
  await pcB.sync();
  assert.equal(pcB.list().length, 0);
  pcA.stop();
  pcB.stop();
});

test("tasks persist across restarts and are kept per user", async () => {
  const dir = tempDir();
  const server = fakeTaskServer();
  server.client.ready = false;
  let email = "a@x.com";
  const first = createTasksSync({ client: server.client, getEmail: () => email, storageDir: dir, logger: quietLogger });
  first.save({ title: "Mine", due_at: "2030-01-02T15:00:00.000Z" });
  first.stop();
  const reopened = createTasksSync({ client: server.client, getEmail: () => email, storageDir: dir, logger: quietLogger });
  assert.equal(reopened.list()[0].title, "Mine");
  email = "b@x.com";
  assert.equal(reopened.list().length, 0);
  reopened.stop();
});

test("a reminder fires once, re-arms after snooze, and never fires for done tasks", () => {
  const server = fakeTaskServer();
  server.client.ready = false;
  let nowMs = Date.parse("2030-01-02T14:00:00.000Z");
  const fired = [];
  const tasks = createTasksSync({
    client: server.client,
    getEmail: () => "a@x.com",
    storageDir: tempDir(),
    logger: quietLogger,
    now: () => nowMs,
    onDue: (event) => fired.push(event)
  });
  const task = tasks.save({ title: "Call", due_at: "2030-01-02T15:00:00.000Z", remind_at: "2030-01-02T14:30:00.000Z" });
  tasks.checkReminders();
  assert.equal(fired.length, 0);
  nowMs = Date.parse("2030-01-02T14:31:00.000Z");
  tasks.checkReminders();
  tasks.checkReminders();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].tasks[0].id, task.id);

  tasks.save({ ...tasks.list()[0], snoozed_until: "2030-01-02T14:46:00.000Z" });
  tasks.checkReminders();
  assert.equal(fired.length, 1);
  nowMs = Date.parse("2030-01-02T14:47:00.000Z");
  tasks.checkReminders();
  assert.equal(fired.length, 2);

  assert.equal(isReminderDue({ status: "done", remind_at: "2030-01-01T00:00:00.000Z" }, nowMs), false);
  tasks.stop();
});

test("many overdue reminders are summarised in one alert", () => {
  const server = fakeTaskServer();
  server.client.ready = false;
  const fired = [];
  const tasks = createTasksSync({ client: server.client, getEmail: () => "a@x.com", storageDir: tempDir(), logger: quietLogger, onDue: (event) => fired.push(event) });
  for (let i = 0; i < 5; i += 1) tasks.save({ title: `T${i}`, due_at: "2020-01-01T00:00:00.000Z", remind_at: "2020-01-01T00:00:00.000Z" });
  tasks.checkReminders();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].summary, true);
  assert.equal(fired[0].tasks.length, 5);
  tasks.stop();
});

test("task validation rejects missing titles and due dates", () => {
  const server = fakeTaskServer();
  const tasks = createTasksSync({ client: server.client, getEmail: () => "a@x.com", storageDir: tempDir(), logger: quietLogger });
  assert.throws(() => tasks.save({ title: " ", due_at: "2030-01-01T00:00:00.000Z" }), /title/);
  assert.throws(() => tasks.save({ title: "x", due_at: "soon" }), /due date/);
  tasks.stop();
});

function fakeSopServer() {
  const docs = new Map();
  const files = new Map();
  let clock = Date.parse("2030-01-01T00:00:00.000Z");
  const client = {
    isReady: () => true,
    async get(route, params) {
      if (route === "/api/sops") {
        const since = params.since || "";
        const list = [...docs.values()].filter((doc) => doc.syncedAt > since).sort((a, b) => a.syncedAt.localeCompare(b.syncedAt));
        return { ok: true, sops: list, cursor: list.at(-1)?.syncedAt || since };
      }
      return { ok: true, versions: [] };
    },
    async post(route, body) {
      const existing = docs.get(body.id);
      const stamp = body.updatedAt || body.deletedAt;
      if (existing && existing.updatedAt >= stamp) return { ok: true, applied: false };
      clock += 1000;
      docs.set(body.id, {
        id: body.id,
        updatedAt: stamp,
        syncedAt: new Date(clock).toISOString(),
        updatedBy: "someone@x.com",
        deleted: route.endsWith("/delete"),
        record: route.endsWith("/delete") ? existing.record : body.record
      });
      return { ok: true, applied: true };
    },
    async upload(_route, { bytes, type, name }) {
      const sha = crypto.createHash("sha256").update(bytes).digest("hex");
      files.set(sha, { bytes, type });
      return { ok: true, fileId: sha, name, type, size: bytes.byteLength };
    },
    async download(route) {
      const sha = route.split("/").pop();
      const stored = files.get(sha);
      return { bytes: stored.bytes, type: stored.type };
    }
  };
  return { client, docs, files };
}

test("SOP saves are shared, conflicting edits are refused, and deletes are restorable", async () => {
  const server = fakeSopServer();
  const alice = createSopLibrary({ client: server.client, getEmail: () => "alice@x.com", storageDir: tempDir(), logger: quietLogger });
  const bob = createSopLibrary({ client: server.client, getEmail: () => "bob@x.com", storageDir: tempDir(), logger: quietLogger });

  const created = await alice.save({ title: "Battery RMA", content_html: "<p>v1</p>" });
  assert.equal(created.ok, true);
  await bob.sync();
  const base = bob.list()[0];
  assert.equal(base.title, "Battery RMA");

  const aliceEdit = await alice.save({ ...created.record, content_html: "<p>v2</p>" }, { baseUpdatedAt: created.record.updated_date });
  assert.equal(aliceEdit.ok, true);
  const bobEdit = await bob.save({ ...base, content_html: "<p>bob</p>" }, { baseUpdatedAt: base.updated_date });
  assert.equal(bobEdit.ok, false);
  assert.equal(bobEdit.reason, "conflict");
  assert.equal(bobEdit.latest.content_html, "<p>v2</p>");

  await bob.remove(base.id);
  await alice.sync();
  const deleted = alice.list()[0];
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.content_html, "<p>v2</p>");
  const restored = await alice.save({ ...deleted, deleted: false }, { force: true });
  assert.equal(restored.ok, true);
  assert.equal(restored.record.deleted, false);
});

test("SOP workbooks, sections and subpages survive restart and sync together", async () => {
  const server = fakeSopServer();
  const storageDir = tempDir();
  const alice = createSopLibrary({client: server.client, getEmail: () => "alice@x.com", storageDir, logger: quietLogger});
  await alice.save({id: "workbook-field", kind: "workbook", title: "Field"});
  await alice.save({id: "workbook-office", kind: "workbook", title: "Office"});
  await alice.save({id: "section-maintenance", kind: "section", title: "Maintenance", workbook_id: "workbook-field"});
  await alice.save({id: "page-root", title: "Checklist", section_id: "section-maintenance"});
  await alice.save({id: "page-child", title: "Details", section_id: "section-maintenance", parent_id: "page-root"});
  const restarted = createSopLibrary({client: server.client, getEmail: () => "alice@x.com", storageDir, logger: quietLogger});
  assert.equal(restarted.list().find((doc) => doc.id === "workbook-field").kind, "workbook");
  const section = restarted.list().find((doc) => doc.id === "section-maintenance");
  await restarted.save({...section, workbook_id: "workbook-office"}, {force: true});
  const bob = createSopLibrary({client: server.client, getEmail: () => "bob@x.com", storageDir: tempDir(), logger: quietLogger});
  await bob.sync();
  assert.equal(bob.list().find((doc) => doc.id === section.id).workbook_id, "workbook-office");
  assert.equal(bob.list().find((doc) => doc.id === "page-child").parent_id, "page-root");
  assert.equal(bob.list().find((doc) => doc.id === "page-child").section_id, section.id);
});

test("SOP files are cached on disk and verified against their hash", async () => {
  const server = fakeSopServer();
  const dirA = tempDir();
  const library = createSopLibrary({ client: server.client, getEmail: () => "a@x.com", storageDir: dirA, logger: quietLogger });
  const bytes = new TextEncoder().encode("hello sop");
  const upload = await library.uploadFile({ name: "a.txt", type: "text/plain", bytes });
  assert.match(upload.file.fileId, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(dirA, "sop-files", upload.file.fileId)));

  const other = createSopLibrary({ client: server.client, getEmail: () => "b@x.com", storageDir: tempDir(), logger: quietLogger });
  const file = await other.getFile(upload.file.fileId, { name: "a.txt" });
  assert.equal(new TextDecoder().decode(file.bytes), "hello sop");

  server.files.set(upload.file.fileId, { bytes: new TextEncoder().encode("tampered"), type: "text/plain" });
  const third = createSopLibrary({ client: server.client, getEmail: () => "c@x.com", storageDir: tempDir(), logger: quietLogger });
  await assert.rejects(third.getFile(upload.file.fileId), /corrupted/);
  await assert.rejects(third.getFile("../../etc/passwd"), /not valid/);
});

test("chat inbox alerts only on new messages and remembers its position", async () => {
  const messages = [];
  const client = {
    isReady: () => true,
    async get(route, params) {
      if (route === "/api/chat/directory") return { ok: true, users: [{ email: "b@x.com", name: "Bob" }] };
      const list = messages.filter((message) => message.createdAt > params.since);
      return { ok: true, messages: list, unreadTotal: list.length, serverTime: "" };
    },
    async post() { return { ok: true }; }
  };
  const dir = tempDir();
  const alerts = [];
  let nowMs = Date.parse("2030-01-01T00:00:00.000Z");
  messages.push({ id: "old", conversationId: "c1", sender: "b@x.com", body: "old", createdAt: "2029-12-31T00:00:00.000Z" });
  const chat = createChatService({ client, getEmail: () => "a@x.com", storageDir: dir, logger: quietLogger, now: () => nowMs, onNewMessages: (event) => alerts.push(event) });
  await chat.poll();
  assert.equal(alerts.length, 0, "history from before first launch is not alerted");

  messages.push({ id: "m1", conversationId: "c1", sender: "b@x.com", body: "hi", createdAt: "2030-01-01T00:00:01.000Z" });
  await chat.poll();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].messages[0].senderName, "Bob");
  await chat.poll();
  assert.equal(alerts.length, 1, "the same message is never alerted twice");

  messages.push({ id: "m2", conversationId: "c1", sender: "b@x.com", body: "while closed", createdAt: "2030-01-01T00:00:05.000Z" });
  const reopened = createChatService({ client, getEmail: () => "a@x.com", storageDir: dir, logger: quietLogger, now: () => nowMs, onNewMessages: (event) => alerts.push(event) });
  await reopened.poll();
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1].messages[0].id, "m2");
  chat.stop();
  reopened.stop();
});

test("collab client sends both tokens and reports Worker errors", async () => {
  const seen = [];
  const client = createCollabClient({
    workerUrl: "https://worker.example",
    getOutboundToken: () => "shared",
    getUserToken: () => "v1.user",
    getAccessHeaders: () => ({ "CF-Access-Client-Id": "id" }),
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      if (String(url).includes("bad")) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404 });
      return new Response(JSON.stringify({ ok: true, value: 1 }), { status: 200 });
    }
  });
  const result = await client.get("/api/tasks", { since: "", x: "1" });
  assert.equal(result.value, 1);
  assert.equal(seen[0].url, "https://worker.example/api/tasks?x=1");
  assert.equal(seen[0].init.headers.Authorization, "Bearer shared");
  assert.equal(seen[0].init.headers["X-EnQuote-User"], "v1.user");
  await assert.rejects(client.post("/bad", {}), (error) => error.code === "not_found" && error.status === 404);

  const offline = createCollabClient({ workerUrl: "https://worker.example", getOutboundToken: () => "", getUserToken: () => "", fetchImpl: async () => { throw new Error("nope"); } });
  assert.equal(offline.isReady(), false);
  await assert.rejects(offline.get("/api/tasks"), (error) => error.offline === true);
});
