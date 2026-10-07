const assert = require("node:assert/strict");
const test = require("node:test");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {createReadonlyPreview, installPreviewIpcGuard, previewRequestAllowed, publicUser} = require("../../electron/readonlyPreview.cjs");

async function fixture({rendererReady = true, readyTimeoutMs = 10000} = {}) {
  const permissions = await import("../../electron/pageAccess.mjs");
  const handles = new Map();
  const sends = new Map();
  const ipc = {handle: (channel, fn) => handles.set(channel, fn), on: (channel, fn) => sends.set(channel, fn)};
  const main = {webContents: {id: 1, send() {}}, isDestroyed: () => false, show() {}, focus() {}};
  let actor = {email: "super@example.com", app_role: "super_admin"};
  let target = {email: "heather@example.com", full_name: "Heather", app_role: "admin", password_hash: "private"};
  let offline = false;
  let identity = {email: actor.email};
  const windows = [];
  const partitionNames = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.reloads = 0;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {id: windows.length + 2, session: options.webPreferences.session, setWindowOpenHandler() {}});
      windows.push(this);
    }
    setMenu() {}
    async loadURL() {if (rendererReady) await handles.get("viewing:context")({sender: this.webContents});}
    isDestroyed() {return this.destroyed;}
    close() {this.destroyed = true; this.emit("closed");}
    reload() {this.reloads++;}
  }
  let controller;
  installPreviewIpcGuard(ipc, () => controller);
  const calls = [];
  for (const channel of ["quotes:list", "quotes:update", "collections:list", "tasks:list", "chat:messages", "profiles:list", "future:unsafe"]) {
    ipc.handle(channel, (_event, ...args) => {calls.push({channel, args}); return [];});
  }
  ipc.on("errors:report", () => calls.push({channel: "errors:report"}));
  controller = createReadonlyPreview({
    BrowserWindow: FakeWindow,
    session: {fromPartition(name) {
      partitionNames.push(name);
      return {
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
        webRequest: {onBeforeRequest() {}}, protocol: {handle() {}},
        async clearStorageData() {calls.push({channel: "clearStorageData"});}
      };
    }},
    net: {}, ipcMain: ipc, getMainWindow: () => main, getIdentity: () => identity,
    getPolicy: async () => ({ok: true, offline, me: actor}),
    getOverview: async () => ({ok: true, users: [target, actor]}),
    getRepository: () => ({}), getUserDataPath: () => "C:\\unused",
    getEntry: () => "C:\\unused\\index.html", canAccessPage: permissions.canAccessPage,
    rolesForUser: permissions.rolesForUser, allPages: permissions.ALL_PAGES,
    logger: {warn() {}}, recheckMs: 3600000, readyTimeoutMs
  });
  const invoke = (id, channel, ...args) => handles.get(channel)({sender: id === 1 ? main.webContents : windows.find(win => win.webContents.id === id).webContents}, ...args);
  return {
    controller, calls, windows, partitionNames, invoke, sends,
    setActor(value) {actor = value;}, setTarget(value) {target = value;},
    setOffline(value) {offline = value;}, setIdentity(value) {identity = value;},
    async start() {await invoke(1, "viewing:start", target.email); return windows.at(-1).webContents.id;}
  };
}

test("native preview requires verified live Super Admin, not renderer roles, cached policy or another sender", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  f.setActor({email: "super@example.com", app_role: "admin"});
  await assert.rejects(f.start(), /Live Super Admin/);
  f.setActor({email: "other@example.com", app_role: "super_admin"});
  await assert.rejects(f.start(), /Live Super Admin/);
  f.setActor({email: "super@example.com", app_role: "submitter", additional_roles: ["super_admin"]});
  f.setOffline(true);
  await assert.rejects(f.start(), /Live Super Admin/);
  f.setOffline(false);
  const id = await f.start();
  await assert.rejects(f.invoke(id, "viewing:start", "heather@example.com"), /blocked/);
  assert.equal(f.windows.length, 1);
});

test("native default-deny guard blocks messages, tasks, credentials, export, every mutation and new IPC channels", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  const id = await f.start();
  const blocked = [
    ["chat:messages", {conversationId: "private"}], ["tasks:list"], ["quotes:update", "id", {}],
    ["collections:list", "autoImportSettings"], ["collections:list", "appErrorLog"],
    ["collections:list", "appNotifications"], ["future:unsafe"], ["profiles:setAvatar"], ["Base44_DTO:list"]
  ];
  for (const [channel, ...args] of blocked) {
    if (["chat:messages", "tasks:list", "quotes:update", "collections:list", "future:unsafe"].includes(channel)) {
      await assert.rejects(f.invoke(id, channel, ...args), /blocked/);
    } else await assert.rejects(f.controller.read(id, channel, args, () => assert.fail("private handler ran")), /blocked/);
  }
  f.sends.get("errors:report")({sender: f.windows[0].webContents}, {});
  assert.equal(f.calls.length, 0);
  await f.invoke(id, "quotes:list");
  assert.equal(f.calls[0].channel, "quotes:list");
  await f.invoke(1, "quotes:update", "id", {});
  assert.equal(f.calls[1].channel, "quotes:update", "main account behavior is unchanged");
});

test("all exposed native operations outside the explicit read allowlist are rejected before their handler runs", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  const id = await f.start();
  const preload = fs.readFileSync(path.join(__dirname, "../../electron/preload.cjs"), "utf8");
  const channels = [...new Set([...preload.matchAll(/invoke\("([^"]+)"/g)].map(match => match[1]))];
  const allowed = new Set([
    "auth:getVerifiedIdentity", "admin:policy", "ui:get-info", "zoom:get",
    "quotes:list", "quotes:get", "products:list", "collections:list", "largeTables:get",
    "sops:list", "sops:versions", "sops:getFile", "profiles:list", "profiles:getAvatar",
    "viewing:context", "viewing:recheck", "viewing:select-user", "viewing:exit"
  ]);
  assert.ok(channels.length > 50, "test covers the actual desktop bridge, not a few example operations");
  for (const channel of channels.filter(name => !allowed.has(name))) {
    await assert.rejects(f.controller.read(id, channel, [], () => assert.fail(`Unsafe handler ran: ${channel}`)), /blocked/);
  }
});

test("an older renderer cannot report successful viewing-mode startup", async t => {
  const f = await fixture({rendererReady: false, readyTimeoutMs: 10});
  t.after(() => f.controller.closeAll());
  await assert.rejects(f.start(), /renderer does not support/);
  assert.equal(f.windows[0].destroyed, true);
});

test("normal viewing context is sanitized and private pages always denied even for a Super Admin target", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  f.setTarget({email: "heather@example.com", app_role: "super_admin", allow_pages: ["Messages"], password_hash: "private"});
  const id = await f.start();
  const context = await f.invoke(id, "viewing:context");
  assert.equal(context.user.email, "heather@example.com");
  assert.equal(context.user.password_hash, undefined);
  for (const page of ["Messages", "Tasks", "Base44_DTO"]) assert.ok(context.user.deny_pages.includes(page));
  const users = await f.invoke(id, "collections:list", "users");
  assert.equal(users[0].password_hash, undefined);
  assert.equal(f.calls.length, 0, "user secrets are never read from the local repository");
  assert.ok(!f.partitionNames[0].startsWith("persist:"));
  assert.equal(f.windows[0].options.webPreferences.sandbox, true);
});

test("native read authorization respects target and actor page overrides", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  f.setTarget({email: "heather@example.com", app_role: "admin", deny_pages: ["SupervisorDashboard"], allow_pages: ["SupervisorDashboard"]});
  const id = await f.start();
  await assert.rejects(f.invoke(id, "collections:list", "supervisorDailyMetrics"), /not granted/);
  f.setActor({email: "super@example.com", app_role: "super_admin", deny_pages: ["Products", "Quotes", "QuoteDetails", "AutoDrafter"]});
  await f.controller.revalidateAll();
  await assert.rejects(f.controller.read(id, "products:list", [], () => assert.fail("handler ran")), /not granted/);
  assert.equal(f.calls.length, 0);
});

test("permission changes refresh normal pages and loss of live authorization closes the window", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  const id = await f.start();
  f.setTarget({email: "heather@example.com", app_role: "approver", deny_pages: ["SupervisorDashboard"]});
  await f.controller.revalidateAll();
  assert.equal(f.windows[0].reloads, 1);
  assert.equal((await f.invoke(id, "viewing:context")).user.app_role, "approver");
  f.setOffline(true);
  await f.controller.revalidateAll();
  assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.controller.isPreview(id), false);
});

test("viewing-console recheck verifies live policy without writes and closes on revocation", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  const id = await f.start();
  const context = await f.invoke(id, "viewing:recheck");
  assert.equal(context.serviceUser.email, "heather@example.com");
  assert.equal(f.calls.length, 0);
  f.setActor({email: "super@example.com", app_role: "admin"});
  await assert.rejects(f.invoke(id, "viewing:recheck"), /Live Super Admin/);
  assert.equal(f.windows[0].destroyed, true);
  await assert.rejects(f.invoke(1, "viewing:recheck"), /not a viewing window/);
});

test("closing windows remain guarded until their renderer is destroyed", async t => {
  const f = await fixture();
  t.after(() => {f.windows[0]?.emit("closed");});
  const id = await f.start();
  f.windows[0].close = () => {};
  await f.invoke(id, "viewing:exit");
  assert.equal(f.controller.isPreview(id), true);
  await assert.rejects(f.invoke(id, "chat:messages", {}), /closing/);
  await assert.rejects(f.invoke(id, "quotes:update", "id", {}), /closing/);
  assert.equal(f.calls.length, 0);
});

test("real-account changes and target removal end preview; selecting users clears isolated storage", async t => {
  const f = await fixture();
  t.after(() => f.controller.closeAll());
  const id = await f.start();
  await f.invoke(id, "viewing:select-user", "super@example.com");
  assert.equal(f.calls[0].channel, "clearStorageData");
  assert.equal((await f.invoke(id, "viewing:context")).user.email, "super@example.com");
  f.setIdentity({email: "someone@example.com"});
  await assert.rejects(f.invoke(id, "quotes:list"), /real account changed/);
  assert.equal(f.controller.isPreview(id), false);
  f.setIdentity({email: "super@example.com"});
  const next = await f.start();
  f.setTarget({email: "removed@example.com", app_role: "admin"});
  await f.controller.revalidateAll();
  assert.equal(f.controller.isPreview(next), false);
});

test("network boundary permits only application GET assets, never remote/private requests or file URLs", () => {
  const allow = (url, method = "GET", origin = "") => previewRequestAllowed({url, method}, origin);
  assert.equal(allow("enquote-preview://app/assets/main.js"), true);
  assert.equal(allow("enquote-preview://app/index.html", "POST"), false);
  for (const url of ["https://worker.example/api/chat", "file:///C:/Users/private.json", "data:text/html,hello", "enquote-preview://other/index.html"]) assert.equal(allow(url), false);
  assert.equal(allow("http://localhost:5173/src/App.jsx", "GET", "http://localhost:5173"), true);
  assert.equal(allow("http://localhost:5173/api/chat", "GET", "http://localhost:5173"), false);
  assert.equal(allow("http://localhost:5173/@fs/C:/private", "GET", "http://localhost:5173"), false);
  assert.deepEqual(publicUser({email: "a@example.com", password: "secret", userToken: "secret"}), {email: "a@example.com"});
});
