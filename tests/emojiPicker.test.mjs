import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {validCustomEmojiId, validCustomEmojiName, customEmojiIdFromReaction} from "../shared/customEmojiRules.js";

const require = createRequire(import.meta.url);
async function load(entry, mocks, exportName = "default") {
  const result = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false, platform: "node",
    format: "cjs", jsx: "automatic", packages: "external", alias: {"@": path.resolve("src")},
    plugins: [{name: "emoji-picker-tests", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports);
  return module.exports[exportName];
}

test("custom emoji IDs and names have exact bounded shapes", () => {
  assert.equal(validCustomEmojiName("a"), true);
  assert.equal(validCustomEmojiName("team-01_test"), true);
  assert.equal(validCustomEmojiName("x".repeat(32)), true);
  for (const name of ["", "_x", "CAPS", "a b", "x".repeat(33), null]) assert.equal(validCustomEmojiName(name), false);
  assert.equal(validCustomEmojiId("a".repeat(64)), true);
  for (const id of ["a".repeat(63), "x".repeat(64), null]) assert.equal(validCustomEmojiId(id), false);
  assert.equal(customEmojiIdFromReaction(`custom:${"b".repeat(64)}`), "b".repeat(64));
  for (const id of ["heart", "custom:bad", null]) assert.equal(customEmojiIdFromReaction(id), null);
});

test("All picker defaults to one shared search, both sections, and independent See all shortcuts", async () => {
  const calls = [];
  const Picker = await load("src\\components\\messages\\EmojiGifPicker.jsx", {
    "lucide-react": {ChevronRight: () => null, Search: () => null},
    "./EmojiPicker": props => {calls.push({kind: "emoji", props}); return React.createElement("span", null, "emoji fixture");},
    "./GiphyPicker": props => {calls.push({kind: "gif", props}); return React.createElement("span", null, "gif fixture");},
    "@/lib/utils": {cn: (...values) => values.filter(Boolean).join(" ")}
  });
  const html = renderToStaticMarkup(React.createElement(Picker, {onCustom() {}, onBuiltin() {}, onGif() {}}));
  assert.match(html, /role="tab" aria-selected="true"[^>]*>All/);
  assert.match(html, /See all emojis/);
  assert.match(html, /See all GIFs/);
  assert.match(html, /aria-label="Emoji results"/);
  assert.match(html, /aria-label="GIF results"/);
  assert.equal((html.match(/<input/g) || []).length, 1);
  assert.equal(calls.find(call => call.kind === "emoji").props.query, "");
  assert.equal(calls.find(call => call.kind === "gif").props.query, "");
  assert.equal(calls.every(call => call.props.preview), true);
});

test("shared search filters built-in and custom emojis and preserves the add action", async () => {
  const Picker = await load("src\\components\\messages\\EmojiPicker.jsx", {
    "lucide-react": {Plus: () => null, Loader2: () => null, ArrowLeft: () => null},
    "sonner": {toast: {}},
    "@/components/ui/button": {Button: ({children, ...props}) => React.createElement("button", props, children)},
    "@/features/collab/customEmojis": {useCustomEmojis: () => ({data: [
      {id: "a".repeat(64), name: "team_heart"}, {id: "b".repeat(64), name: "party"}
    ]})},
    "@tanstack/react-query": {useQueryClient: () => ({})},
    "@/features/collab/collabApi": {chatApi: {}},
    "@/lib/userScopedStorage": {getCurrentUserNamespace: () => "test@example.com"},
    "./CustomEmojiImage": ({name}) => React.createElement("img", {alt: name}),
    "@/lib/utils": {cn: (...values) => values.filter(Boolean).join(" ")}
  });
  const html = renderToStaticMarkup(React.createElement(Picker, {query: "heart", preview: true, onCustom() {}, onBuiltin() {}}));
  assert.match(html, /Use team_heart/);
  assert.match(html, /Use Love/);
  assert.doesNotMatch(html, /Use party|Use Like|Search emojis/);
  assert.match(html, /Add emoji/);
  const empty = renderToStaticMarkup(React.createElement(Picker, {query: "absent", preview: true}));
  assert.match(empty, /No matching emojis/);
});

test("emoji queries stop retrying and polling when a full desktop restart is required", async () => {
  const hook = await load("src\\features\\collab\\customEmojis.js", {
    "@tanstack/react-query": {useQuery: options => options},
    "./collabApi": {chatApi: {emojis: async () => []}},
    "@/lib/userScopedStorage": {getCurrentUserNamespace: () => "test@example.com"}
  }, "useCustomEmojis");
  const options = hook();
  const staleDesktop = {code: "desktop_restart_required"};
  assert.equal(options.retry(0, staleDesktop), false);
  assert.equal(options.refetchInterval({state: {error: staleDesktop}}), false);
  const staleService = {code: "emoji_service_update_required"};
  assert.equal(options.retry(0, staleService), false);
  assert.equal(options.refetchInterval({state: {error: staleService}}), false);
  assert.equal(options.retry(0, new Error("Offline")), true);
  assert.equal(options.retry(1, new Error("Offline")), false);
  assert.equal(options.refetchInterval({state: {error: null}}), 60000);
  assert.equal(hook(false).refetchInterval({state: {error: null}}), false);
});

test("image preparation validates exact size limits and keeps original animated GIF data", async () => {
  const prepare = await load("src\\features\\collab\\customEmojis.js", {
    "@tanstack/react-query": {},
    "./collabApi": {chatApi: {}},
    "@/lib/userScopedStorage": {getCurrentUserNamespace: () => "test@example.com"}
  }, "customEmojiFile");
  const originalReader = globalThis.FileReader, originalImage = globalThis.Image;
  const dataUrl = "data:image/gif;base64,R0lGODlh";
  globalThis.FileReader = class {
    readAsDataURL() {this.result = dataUrl; this.onload();}
  };
  globalThis.Image = class {
    naturalWidth = 32;
    naturalHeight = 32;
    set src(value) {assert.equal(value, dataUrl); this.onload();}
  };
  try {
    assert.equal(await prepare({type: "image/gif", size: 512 * 1024}), dataUrl);
    await assert.rejects(prepare({type: "image/gif", size: 512 * 1024 + 1}), /512 KB/);
    await assert.rejects(prepare({type: "image/png", size: 0}), /512 KB/);
    await assert.rejects(prepare({type: "image/svg+xml", size: 100}), /PNG/);
  } finally {
    if (originalReader) globalThis.FileReader = originalReader; else delete globalThis.FileReader;
    if (originalImage) globalThis.Image = originalImage; else delete globalThis.Image;
  }
});
