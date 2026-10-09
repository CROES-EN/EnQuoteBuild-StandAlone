const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {createChatService} = require("../../electron/chatService.cjs");

test("fresh Electron startup registers every emoji preload method before authentication", async () => {
  const handlers = new Map(), calls = [];
  const client = {
    get: async route => {calls.push(route); return {ok: true, emojis: []};},
    post: async (route, payload) => {calls.push({route, payload}); return {ok: true, emoji: {id: "a".repeat(64), name: payload.name}};}
  };
  const mocks = {
    "../shared/refundFeature.json": {enabled: true},
    "electron": {},
    "./refundSubmission.cjs": {createRefundSubmission: () => ({
      status: async () => ({ok: true}), select: async () => ({ok: true}),
      submit: async () => ({ok: true}), retry: async () => ({ok: true})
    })},
    "./refundCsvSource.cjs": {createRefundCsvSource: () => ({
      status: () => ({ok: true}), select: async () => ({ok: true}),
      sync: async () => ({ok: true}), start() {}, stop() {}
    })},
    "./refundCsv.cjs": {createRefundCsv: () => ({
      status: () => ({ok: true}), select: async () => ({ok: true}),
      submit: async () => ({ok: true}), retry: async () => ({ok: true})
    })},
    "./refundFormWindow.cjs": {createRefundFormWindow: () => ({
      open: async () => ({ok: true}), show: async () => ({ok: true}),
      hide: () => ({ok: true}), close() {}
    })},
    "./collabClient.cjs": {createCollabClient: () => client},
    "./tasksSync.cjs": {createTasksSync: () => ({})},
    "./sopLibrary.cjs": {createSopLibrary: () => ({})},
    "./chatService.cjs": {createChatService},
    "./profileService.cjs": {createProfileService: () => ({})},
    "./adminFeatures.cjs": {setupAdminFeatures: () => ({realtimeHandlers: {}})},
    "./oneNoteImport.cjs": {createOneNoteImport: () => ({})},
    "./refundWorkbook.cjs": {createRefundWorkbook: () => ({
      status: async () => ({ok: true, configured: false}),
      select: async () => ({ok: true}),
      sync: async () => ({ok: true}),
      syncStatus: () => ({ok: true}),
      resolveConflict: async () => ({ok: true})
    })}
  };
  const module = {exports: {}};
  new Function("require", "module", "exports", fs.readFileSync(require.resolve("../../electron/collabFeatures.cjs"), "utf8"))(
    id => {assert.ok(Object.hasOwn(mocks, id)); return mocks[id];}, module, module.exports);
  module.exports.setupCollabFeatures({
    ipcMain: {handle: (channel, fn) => {assert.equal(handlers.has(channel), false); handlers.set(channel, fn);}},
    getEmail: () => "test@example.com", storageDir: ".", getMainWindow: () => null
  });
  const globals = {};
  new Function("require", fs.readFileSync(require.resolve("../../electron/preload.cjs"), "utf8"))(() => ({
    contextBridge: {exposeInMainWorld: (name, api) => {globals[name] = api;}},
    ipcRenderer: {on() {}, invoke: async (channel, ...args) => {
      assert.ok(handlers.has(channel), `Handler missing: ${channel}`);
      return handlers.get(channel)({}, ...args);
    }}
  }));
  for (const method of ["emojis", "uploadEmoji", "getEmoji", "saveGifEmoji"]) {
    assert.equal(typeof globals.enquoteLocal.chat[method], "function");
    assert.ok(handlers.has(`chat:${method}`));
  }
  assert.deepEqual(await globals.enquoteLocal.chat.emojis(), {ok: true, emojis: []});
  for (const method of [
    "list", "submit", "update", "csvStatus", "selectCsv", "submitNative", "retryCsv",
    "sourceStatus", "selectSource", "syncSource", "onSourceChanged",
    "trackerStatus", "connectTracker", "submitToTracker", "retryTracker",
    "openForm", "showForm", "hideForm", "onFormStatus", "workbookStatus", "connectWorkbook",
    "syncWorkbook", "workbookSyncStatus", "resolveWorkbookConflict", "onChanged"
  ]) {
    assert.equal(typeof globals.enquoteLocal.refundRequests[method], "function");
  }
  assert.ok(handlers.has("refundRequests:list"));
  assert.deepEqual(await globals.enquoteLocal.refundRequests.openForm("https://forms.office.com/"), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.csvStatus(), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.selectCsv(), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.submitNative({}), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.retryCsv(), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.sourceStatus(), {ok: true});
  assert.deepEqual(await globals.enquoteLocal.refundRequests.syncSource(), {ok: true});
  assert.ok(handlers.has("refundWorkbook:sync"));
  assert.deepEqual(await globals.enquoteLocal.refundRequests.workbookStatus(), {ok: true, configured: false});
  const payload = {gifId: "gif123", name: "team"};
  assert.equal((await globals.enquoteLocal.chat.saveGifEmoji(payload)).emoji.name, "team");
  assert.deepEqual(calls, ["/api/chat/emojis", {route: "/api/chat/emojis/from-gif", payload}]);
  mocks["../shared/refundFeature.json"].enabled = false;
  const before = calls.length;
  for (const channel of ["refundRequests:list", "refundRequests:submitToTracker", "refundWorkbook:sync", "refundRequests:syncSource"]) {
    const result = await handlers.get(channel)({}, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason, "feature_disabled");
  }
  assert.equal(calls.length, before, "disabled refund operations never contact the service");
});
