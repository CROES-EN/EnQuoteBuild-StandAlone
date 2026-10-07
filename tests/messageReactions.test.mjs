import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
test("reaction actions reveal on hover or focus, show selected counts and names, and gate admin removal", async () => {
  const mocks = {
    "@/lib/utils": {cn: (...values) => values.filter(Boolean).join(" ")},
    "lucide-react": {MoreVertical: () => null, SmilePlus: () => null},
    "@/features/collab/customEmojis": {useCustomEmojis: () => ({data: [{id: "a".repeat(64), name: "team"}]})},
    "./EmojiPicker": () => null,
    "./CustomEmojiImage": ({name, size}) => React.createElement("img", {alt: `:${name}:`, width: size, height: size}),
    "@/components/ui/popover": {Popover: ({children}) => children, PopoverTrigger: ({children}) => children, PopoverContent: ({children}) => children},
    "./ConversationDialogs": {displayName: (email, names) => names.get(email) || email},
    "@/components/ui/dropdown-menu": {
      DropdownMenu: ({children}) => children,
      DropdownMenuTrigger: ({children}) => children,
      DropdownMenuContent: ({children}) => React.createElement("div", null, children),
      DropdownMenuItem: ({children}) => React.createElement("span", null, children),
      DropdownMenuSeparator: () => null
    }
  };
  const result = await build({
    entryPoints: [path.resolve("src\\components\\messages\\MessageReactions.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
    packages: "external", alias: {"@": path.resolve("src")},
    plugins: [{name: "reaction-render", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports);
  const props = {
    message: {reactions: [
      {emoji: "heart", users: ["alice@example.com", "bob@example.com"]},
      {emoji: "thumbs_up", users: ["alice@example.com"]}
    ]},
    meEmail: "alice@example.com", names: new Map([["alice@example.com", "Alice"], ["bob@example.com", "Bob"]]),
    onReact: async () => {}, onRemove: () => {}
  };
  const html = renderToStaticMarkup(React.createElement(module.exports.default, props));
  assert.match(html, /group-hover\/message:opacity-100/);
  assert.match(html, /group-focus-within\/message:opacity-100/);
  assert.match(html, /aria-label="Message options"/);
  assert.match(html, /absolute bottom-full/);
  assert.match(html, /bottom-full right-0 z-10 pb-1/);
  assert.doesNotMatch(html, /mb-1/);
  assert.match(html, /h-9 w-9 items-center justify-center rounded-md text-xl/);
  assert.match(html, /aria-label="React: Love" aria-pressed="true"/);
  assert.match(html, /aria-label="Love: 2 reactions" title="Alice, Bob"/);
  assert.doesNotMatch(html, /Remove message \(admin\)/);
  const admin = renderToStaticMarkup(React.createElement(module.exports.default, {...props, isChatAdmin: true}));
  assert.match(admin, /Remove message \(admin\)/);
  for (const reaction of ["thumbs_up", "heart", "laugh", "surprised", "sad", "celebrate"]) {
    assert.ok(html.includes(`data-reaction-icon="${reaction}"`));
  }
  assert.match(html, /width="24" height="24"/);
  assert.match(html, /width="20" height="20"/);
  assert.match(html, /width="28" height="28"/);
  assert.doesNotMatch(html, /👍|❤️|😆|😮|😢|🎉/u);
  const custom = renderToStaticMarkup(React.createElement(module.exports.default, {...props, message: {reactions: [
    {emoji: `custom:${"a".repeat(64)}`, users: ["alice@example.com", "bob@example.com"]}
  ]}}));
  assert.match(custom, /aria-label="More emoji reactions"/);
  assert.match(custom, /aria-label="team: 2 reactions"/);
  assert.match(custom, /aria-pressed="true"/);
  assert.match(custom, /alt=":team:" width="28" height="28"/);
});
