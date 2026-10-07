import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(entry) {
  const result = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test("incoming chats minimize without interrupting another chat; tabs expand, dedupe, minimize, and close", async () => {
  const {updateDock} = await load("src\\features\\collab\\chatDockState.js");
  let state = {tabs: [], expandedIds: []};
  state = updateDock(state, {type: "open", id: "bob", minimized: true});
  assert.deepEqual(state, {tabs: [{id: "bob", opened: false}], expandedIds: []});
  state = updateDock(state, {type: "open", id: "bob"});
  assert.deepEqual(state.expandedIds, ["bob"]);
  assert.equal(state.tabs[0].opened, true);
  state = updateDock(state, {type: "open", id: "carol", minimized: true});
  assert.deepEqual(state.expandedIds, ["bob"]);
  assert.equal(state.tabs.length, 2);
  state = updateDock(state, {type: "open", id: "bob", minimized: true});
  assert.equal(state.tabs.length, 2);
  state = updateDock(state, {type: "minimize"});
  assert.deepEqual(state.expandedIds, []);
  assert.equal(state.tabs[0].opened, true, "minimizing preserves the mounted composer");
  state = updateDock(state, {type: "open", id: "carol"});
  state = updateDock(state, {type: "close", id: "bob"});
  assert.deepEqual(state.expandedIds, ["carol"]);
  state = updateDock(state, {type: "close", id: "carol"});
  assert.deepEqual(state, {tabs: [], expandedIds: []});
  assert.deepEqual(updateDock(state, {type: "reset"}), state);
});

test("Messages routes use the full-page thread while other tabs allow floating chats", async () => {
  const {isMessagesPage} = await load("src\\features\\collab\\chatDockState.js");
  for (const route of ["/Messages", "/Messages/", "/messages"]) {
    assert.equal(isMessagesPage(route), true);
  }
  for (const route of ["/Quotes", "/Products", "/QuoteDetails", "/MessagesArchive", "/"]) {
    assert.equal(isMessagesPage(route), false);
  }
});

test("the dock is hidden and its composer inactive in Messages, retaining drafts for other tabs", async () => {
  let pathname = "/Messages";
  let tabs = [{id: "bob", opened: true}];
  let expandedIds = ["bob"];
  let reducedMotion = false;
  const transitions = [];
  let recentOpen = false;
  let pickerOpen = false;
  let stateIndex = 0;
  const dialogs = [];
  const views = [];
  const mocks = {
    "framer-motion": {
      useReducedMotion: () => reducedMotion,
      AnimatePresence: ({children}) => children,
      motion: {section: ({initial, animate, exit, transition, children, ...props}) => {
        transitions.push(transition);
        return React.createElement("section", props, children);
      }}
    },
    sonner: {toast: {error: () => {}}},
    "react-dom": {createPortal: (children, container) => {
      assert.equal(container, globalThis.document.body);
      return children;
    }},
    react: {...React, useReducer: () => [{tabs, expandedIds}, () => {}], useState: initial => {
      const index = stateIndex++;
      if (index === 1 && recentOpen) return [[
        {id: "older", kind: "group", name: "Older team", lastMessageAt: "2026-10-01"},
        {id: "newer", kind: "group", name: "Latest team", lastMessageAt: "2026-10-07", unread: 2}
      ], () => {}];
      if (index === 4) return [pickerOpen, () => {}];
      if (index === 5) return [recentOpen, () => {}];
      return React.useState(initial);
    }},
    "react-router-dom": {useLocation: () => ({pathname, search: "?c=bob"}), useNavigate: () => () => {}},
    "@/components/auth/RoleGuard": {useUserRole: () => ({user: {email: "me@example.com", app_role: "submitter"}})},
    "@/features/admin/adminApi": {useAccessPolicy: () => ({policy: null})},
    "@/features/collab/collabApi": {hasCollabBridge: () => true},
    "./ConversationDialogs": {
      displayName: (email, names) => names.get(email) || email,
      NewConversationDialog: props => { dialogs.push(props); return null; }
    },
    "@/components/profile/UserAvatar": {UserAvatar: ({name}) => React.createElement("span", {"data-avatar": true}, name)},
    "@/pages/Messages": props => {
      views.push(props);
      return React.createElement("textarea", {"data-visible": String(props.visible)});
    },
    "lucide-react": new Proxy({}, {get: () => () => null})
  };
  globalThis.window = {innerWidth: 1280, innerHeight: 800, localStorage: {getItem: () => "me@example.com"}};
  globalThis.document = {body: {}};
  try {
    const result = await build({
      entryPoints: [path.resolve("src\\components\\messages\\ChatDock.jsx")],
      bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
      packages: "external", alias: {"@": path.resolve("src")},
      plugins: [{name: "dock-test", setup(builder) {
        builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
      }}]
    });
    const module = {exports: {}};
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports);
    const Dock = module.exports.default;
    const render = () => { stateIndex = 0; return renderToStaticMarkup(React.createElement(Dock)); };
    const hidden = render();
    assert.match(hidden, /<aside[^>]*class="[^"]*\bhidden"/);
    assert.equal(views.at(-1).visible, false);
    pathname = "/Quotes";
    const shown = render();
    assert.match(shown, /<aside[^>]*class="[^"]*\bflex"/);
    assert.match(shown, /bottom-0 right-0/);
    assert.match(shown, /aria-label="Resize chat with Conversation"/);
    assert.match(shown, /width:380px;height:540px/);
    assert.match(shown, /aria-label="Message someone"[^>]*style="bottom:8px;right:0"/);
    assert.doesNotMatch(shown, /aria-label="Open chat with Conversation"/);
    assert.match(shown, /pointer-events-none fixed inset-0 z-\[45\]/);
    assert.match(shown, /<aside[^>]*flex-row-reverse items-end/);
    assert.equal(views.at(-1).visible, true);
    assert.equal(views.at(-1).conversationId, "bob");
    assert.equal(transitions.at(-1).duration, 0.16);
    reducedMotion = true;
    render();
    assert.equal(transitions.at(-1).duration, 0);
    reducedMotion = false;
    tabs = [{id: "bob", opened: true}, {id: "carol", opened: true}];
    expandedIds = ["bob", "carol"];
    views.length = 0;
    const sideBySide = render();
    assert.match(sideBySide, /aria-label="Expanded chats"/);
    assert.match(sideBySide, /flex-row-reverse items-end overflow-x-auto/);
    assert.equal(views.filter(view => view.visible).length, 2);
    assert.doesNotMatch(sideBySide, /aria-label="Open chat with Conversation"/);
    tabs = [{id: "bob", opened: true}];
    expandedIds = [];
    const minimized = render();
    assert.match(minimized, /aria-label="Message someone"/);
    assert.match(minimized, /aria-label="Open chat with Conversation"/);
    assert.equal(views.at(-1).visible, false);
    assert.match(minimized, /display:none/);
    assert.doesNotMatch(minimized, /display:flex/);
    tabs = [{id: "bob", opened: true}, {id: "andrew", opened: true}];
    expandedIds = ["bob"];
    const withMinimizedNeighbor = render();
    assert.match(withMinimizedNeighbor, /aria-label="Open chat with Conversation"/);
    assert.match(withMinimizedNeighbor, /pointer-events-auto relative z-10 flex/);
    assert.match(withMinimizedNeighbor, /aria-hidden="true" inert=""[^>]*display:none|display:none[^>]*aria-hidden="true" inert=""/);
    assert.match(withMinimizedNeighbor, /pointer-events-none relative flex min-w-0/);
    tabs = [];
    pathname = "/Messages";
    const empty = render();
    assert.match(empty, /aria-label="Message someone"/);
    assert.match(empty, /bottom-4 right-4/);
    assert.match(empty, /<aside[^>]*class="[^"]*\bhidden"/);
    assert.match(empty, /aria-label="Message someone"[^>]*class="[^"]*rounded-full/);
    assert.match(empty, /aria-label="Message someone"[^>]*class="[^"]*pointer-events-auto[^"]*bg-primary text-primary-foreground/);
    assert.match(empty, /aria-label="Message someone"[^>]*class="[^"]*h-10 w-10/);
    recentOpen = true;
    tabs = [{id: "bob", opened: true}];
    const recent = render();
    assert.match(recent, /aria-label="Recent conversations"/);
    assert.match(recent, /fixed bottom-0 right-0/);
    assert.doesNotMatch(recent, /aria-label="Message someone"/);
    assert.match(recent, /No messages yet/);
    assert.match(recent, /aria-label="New conversation"/);
    assert.ok(recent.indexOf("Latest team") < recent.indexOf("Older team"));
    assert.match(recent, />2<\/span>/);
    assert.equal(views.at(-1).visible, false);
    pickerOpen = true;
    const picker = render();
    assert.match(picker, /Back to recent conversations/);
    assert.doesNotMatch(picker, /Latest team/);
    assert.equal(dialogs.at(-1).embedded, true);
    assert.equal(dialogs.at(-1).open, true);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("multiple chats stay expanded and minimizing or closing one does not hide the others", async () => {
  const {updateDock} = await load("src\\features\\collab\\chatDockState.js");
  let state = {tabs: [], expandedIds: []};
  for (const id of ["bob", "carol", "dave"]) state = updateDock(state, {type: "open", id});
  assert.deepEqual(state.expandedIds, ["bob", "carol", "dave"]);
  state = updateDock(state, {type: "open", id: "carol"});
  assert.equal(state.tabs.length, 3);
  assert.equal(state.expandedIds.length, 3);
  state = updateDock(state, {type: "minimize", id: "carol"});
  assert.deepEqual(state.expandedIds, ["bob", "dave"]);
  assert.equal(state.tabs.find(tab => tab.id === "carol").opened, true);
  state = updateDock(state, {type: "close", id: "bob"});
  assert.deepEqual(state.expandedIds, ["dave"]);
  state = updateDock(state, {type: "open", id: "incoming", minimized: true});
  assert.deepEqual(state.expandedIds, ["dave"]);
  assert.deepEqual(updateDock(state, {type: "reset"}), {tabs: [], expandedIds: []});
});

test("chat resizing keeps usable minimums and fits small or resized viewports", async () => {
  const {clampChatWindowSize} = await load("src\\features\\collab\\chatWindowSize.js");
  const viewport = {width: 1280, height: 800};
  assert.deepEqual(clampChatWindowSize({width: 500, height: 600}, viewport), {width: 500, height: 600});
  assert.deepEqual(clampChatWindowSize({width: 100, height: 100}, viewport), {width: 320, height: 300});
  assert.deepEqual(clampChatWindowSize({width: 2000, height: 2000}, viewport), {width: 1280, height: 744});
  assert.deepEqual(clampChatWindowSize({width: 500, height: 600}, {width: 360, height: 320}), {width: 360, height: 264});
});

test("only new unread incoming messages create tabs, not startup history or repeated updates", async () => {
  const {incomingConversationIds} = await load("src\\features\\collab\\chatDockState.js");
  const old = [{id: "bob", lastMessageAt: "2026-10-07T17:00:00Z", lastSender: "bob@example.com", unread: 3}];
  assert.deepEqual(incomingConversationIds(null, old, "me@example.com"), []);
  assert.deepEqual(incomingConversationIds(old, old, "me@example.com"), []);
  const incoming = [{...old[0], lastMessageAt: "2026-10-07T18:00:00Z", unread: 4}];
  assert.deepEqual(incomingConversationIds(old, incoming, "me@example.com"), ["bob"]);
  assert.deepEqual(incomingConversationIds(old, [{...incoming[0], unread: 0}], "me@example.com"), []);
  assert.deepEqual(incomingConversationIds(old, [{...incoming[0], lastSender: "me@example.com"}], "me@example.com"), []);
});

test("dock events and successful sends are scoped to the signed-in session", async () => {
  const storage = new Map([["enquote_local_session_email", "me@example.com"]]);
  const target = new EventTarget();
  globalThis.window = {
    localStorage: {getItem: key => storage.get(key) ?? null},
    dispatchEvent: event => target.dispatchEvent(event),
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
    enquoteLocal: {chat: {send: async payload => ({ok: true, message: payload})}}
  };
  try {
    const stateApi = await load("src\\features\\collab\\chatDockState.js");
    const seen = [];
    const off = stateApi.onChatDockOpen(detail => seen.push(detail));
    stateApi.openChatDock("bob");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].minimized, false);
    window.dispatchEvent(new CustomEvent("enquote_chat_dock_open", {
      detail: {owner: "another@example.com", conversationId: "private"}
    }));
    assert.equal(seen.length, 1);
    const {chatApi} = await load("src\\features\\collab\\collabApi.js");
    await chatApi.send({conversationId: "carol"});
    assert.equal(seen.at(-1).conversationId, "carol");
    window.enquoteLocal.chat.send = async () => ({ok: false, error: "Offline"});
    await assert.rejects(chatApi.send({conversationId: "failed"}), /Offline/);
    assert.equal(seen.length, 2);
    window.enquoteLocal.chat.send = async payload => {
      storage.set("enquote_local_session_email", "next@example.com");
      return {ok: true, message: payload};
    };
    await chatApi.send({conversationId: "old-user"});
    assert.equal(seen.length, 2, "an old-session send cannot open the next user's dock");
    off();
  } finally {
    delete globalThis.window;
  }
});

test("expanded dock keeps notification focus across full-page navigation and restores it on minimize", async () => {
  const calls = [];
  globalThis.window = {
    localStorage: {getItem: () => "me@example.com"},
    enquoteLocal: {chat: {setActiveConversation: async id => {calls.push(id); return {ok: true};}}}
  };
  try {
    const {registerActiveChatView} = await load("src\\features\\collab\\collabApi.js");
    const leavePage = registerActiveChatView("page-chat");
    const minimize = registerActiveChatView("dock-chat", 1);
    leavePage();
    assert.equal(calls.at(-1), "dock-chat");
    const openPage = registerActiveChatView("another-page-chat");
    assert.equal(calls.at(-1), "dock-chat");
    minimize();
    assert.equal(calls.at(-1), "another-page-chat");
    openPage();
    assert.equal(calls.at(-1), null);
  } finally {
    delete globalThis.window;
  }
});
