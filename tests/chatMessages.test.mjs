import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
async function load() {
  const result = await build({
    stdin: {
      contents: 'export * from "@/features/collab/chatMessages"; export * from "@/features/collab/chatReactions"; export {chatApi} from "@/features/collab/collabApi";',
      resolveDir: path.resolve(".")
    },
    bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("new emoji IPC calls explain a stale Electron main process instead of exposing raw handler errors", async () => {
  globalThis.window = {enquoteLocal: {chat: {
    emojis: async () => {throw new Error("Error invoking remote method 'chat:emojis': Error: No handler registered for 'chat:emojis'");},
    saveGifEmoji: async () => {throw new Error("No handler registered for 'chat:saveGifEmoji'");}
  }}};
  try {
    const {chatApi} = await load();
    for (const call of [() => chatApi.emojis(), () => chatApi.saveGifEmoji({name: "team", gifId: "gif123"})]) {
      await assert.rejects(call(), error => error.code === "desktop_restart_required" && /full restart/.test(error.message));
    }
    window.enquoteLocal.chat.emojis = async () => {throw new Error("Connection failed");};
    await assert.rejects(chatApi.emojis(), /Connection failed/, "unrelated errors remain explicit");
  } finally {delete globalThis.window;}
});

test("missing emoji service routes report deployment requirements without calling a GIF deleted", async () => {
  const missing = async () => ({ok: false, reason: "not_found", error: "not_found"});
  globalThis.window = {enquoteLocal: {chat: {
    emojis: missing, uploadEmoji: missing, saveGifEmoji: missing, getEmoji: missing
  }}};
  try {
    const {chatApi} = await load();
    for (const call of [() => chatApi.emojis(), () => chatApi.uploadEmoji({}), () => chatApi.saveGifEmoji({})]) {
      await assert.rejects(call(), error => error.code === "emoji_service_update_required" && /updated Worker/.test(error.message));
    }
    await assert.rejects(chatApi.getEmoji("a".repeat(64)), /no longer exists/, "individual missing images still report not found");
  } finally {delete globalThis.window;}
});

test("reaction updates reach both views, remove badges, and cannot cross sessions or broadcast on failure", async () => {
    const events = new EventTarget();
    let email = "me@example.com";
    const update = {conversationId: "chat", reactions: {m1: [{emoji: "heart", users: [email]}]}};
    globalThis.window = {
      localStorage: {getItem: () => email},
      dispatchEvent: event => events.dispatchEvent(event),
      addEventListener: (...args) => events.addEventListener(...args),
      removeEventListener: (...args) => events.removeEventListener(...args),
      enquoteLocal: {chat: {react: async () => ({ok: true, ...update})}}
    };
    try {
      const api = await load();
      let page = [{id: "m1", body: "Hello"}, {id: "m2", body: "Other"}];
      let dock = [...page];
      const offPage = api.onChatReactionsChanged(result => {page = api.mergeReactions(page, result.reactions);});
      const offDock = api.onChatReactionsChanged(result => {dock = api.mergeReactions(dock, result.reactions);});
      await api.chatApi.react({conversationId: "chat", messageId: "m1", emoji: "heart", active: true});
      assert.deepEqual(page, dock);
      assert.deepEqual(dock[0].reactions, update.reactions.m1);
      assert.equal(dock[1].reactions, undefined);
      api.notifyChatReactionsChanged({conversationId: "chat", reactions: {m1: []}}, email);
      assert.deepEqual(dock[0].reactions, []);
      window.enquoteLocal.chat.react = async () => ({ok: false, error: "Offline"});
      await assert.rejects(api.chatApi.react({}), /Offline/);
      window.enquoteLocal.chat.react = async () => {email = "other@example.com"; return {ok: true, ...update};};
      await api.chatApi.react({});
      assert.deepEqual(dock[0].reactions, []);
      offPage(); offDock();
    } finally {delete globalThis.window;}
  });

test("a confirmed send updates both chat views without any server push and failed sends do not broadcast", async () => {
  const events = new EventTarget();
  let email = "me@example.com";
  const sent = {id: "message-1", conversationId: "heather", body: "Hello :)", createdAt: "2026-10-07T18:04:00Z", attachments: []};
  globalThis.window = {
    localStorage: {getItem: () => email},
    dispatchEvent: event => events.dispatchEvent(event),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    enquoteLocal: {chat: {send: async () => ({ok: true, message: sent})}}
  };
  try {
    const api = await load();
    let fullPage = [];
    let dock = [];
    const offPage = api.onChatMessageSent(message => {fullPage = api.mergeMessages(fullPage, [message]);});
    const offDock = api.onChatMessageSent(message => {dock = api.mergeMessages(dock, [message]);});
    await api.chatApi.send({conversationId: "heather", body: "Hello :)"});
    assert.deepEqual(fullPage, [sent]);
    assert.deepEqual(dock, [sent]);
    assert.deepEqual(api.mergeMessages(dock, []), [sent], "an older empty load cannot erase the confirmed send");
    assert.deepEqual(api.mergeMessages(dock, [sent]), [sent], "a later server replay cannot duplicate it");
    window.enquoteLocal.chat.send = async () => ({ok: false, error: "Offline"});
    await assert.rejects(api.chatApi.send({conversationId: "heather"}), /Offline/);
    assert.equal(dock.length, 1);
    events.dispatchEvent(new CustomEvent("enquote_chat_message_sent", {
      detail: {owner: "other@example.com", message: {...sent, id: "private"}}
    }));
    assert.equal(dock.length, 1);
    window.enquoteLocal.chat.send = async () => {
      email = "next@example.com";
      return {ok: true, message: {...sent, id: "late"}};
    };
    await api.chatApi.send({conversationId: "heather"});
    assert.equal(dock.length, 1);
    offPage();
    offDock();
    api.notifyChatMessageSent({...sent, id: "after-unsubscribe"}, email);
    assert.equal(dock.length, 1);
  } finally {
    delete globalThis.window;
  }
});

test("history merges keep chronological order and replace matching records rather than duplicating them", async () => {
  const {mergeMessages} = await load();
  const early = {id: "early", createdAt: "2026-10-07T18:00:00Z"};
  const late = {id: "late", createdAt: "2026-10-07T18:04:00Z", body: "Hello"};
  assert.deepEqual(mergeMessages([late], [early, {...late, body: "Confirmed"}]), [early, {...late, body: "Confirmed"}]);
});
