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
    "./collabClient.cjs": {createCollabClient: () => client},
    "./tasksSync.cjs": {createTasksSync: () => ({})},
    "./sopLibrary.cjs": {createSopLibrary: () => ({})},
    "./chatService.cjs": {createChatService},
    "./profileService.cjs": {createProfileService: () => ({})},
    "./adminFeatures.cjs": {setupAdminFeatures: () => ({realtimeHandlers: {}})},
    "./oneNoteImport.cjs": {createOneNoteImport: () => ({})}
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
  const payload = {gifId: "gif123", name: "team"};
  assert.equal((await globals.enquoteLocal.chat.saveGifEmoji(payload)).emoji.name, "team");
  assert.deepEqual(calls, ["/api/chat/emojis", {route: "/api/chat/emojis/from-gif", payload}]);
});
