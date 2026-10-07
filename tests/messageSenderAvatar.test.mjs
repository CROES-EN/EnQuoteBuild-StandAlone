import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
async function load() {
  const mocks = {
    "@/components/profile/UserAvatar": {UserAvatar: ({email, name, size, className}) =>
      React.createElement("img", {src: `profile:${email}`, alt: name, width: size, height: size, className})}
  };
  const result = await build({
    entryPoints: [path.resolve("src\\components\\messages\\MessageSenderAvatar.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
    packages: "external", alias: {"@": path.resolve("src")},
    plugins: [{name: "avatar-render", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports);
  return module.exports;
}

test("messages use the sender's profile avatar with consistent size and label alignment", async () => {
  const {default: Avatar} = await load();
  const props = {email: "bob@example.com", name: "Bob", show: true};
  const received = renderToStaticMarkup(React.createElement(Avatar, {...props, hasSenderLabel: true}));
  assert.match(received, /src="profile:bob@example.com"/);
  assert.match(received, /width="32" height="32"/);
  assert.match(received, /class="mt-5"/);
  const own = renderToStaticMarkup(React.createElement(Avatar, {...props, email: "me@example.com"}));
  assert.match(own, /src="profile:me@example.com"/);
  assert.match(own, /class="mt-0.5"/);
  const continuation = renderToStaticMarkup(React.createElement(Avatar, {...props, show: false}));
  assert.doesNotMatch(continuation, /<img/);
  assert.match(continuation, /h-8 w-8 shrink-0.*aria-hidden="true"/);
});

test("sender groups restart on first message, sender change, or exactly five minutes", async () => {
  const {startsMessageSenderGroup} = await load();
  const previous = {sender: "bob@example.com", createdAt: "2026-10-07T19:00:00Z"};
  assert.equal(startsMessageSenderGroup(previous), true);
  assert.equal(startsMessageSenderGroup({...previous, createdAt: "2026-10-07T19:04:59Z"}, previous), false);
  assert.equal(startsMessageSenderGroup({...previous, createdAt: "2026-10-07T19:05:00Z"}, previous), true);
  assert.equal(startsMessageSenderGroup({...previous, sender: "alice@example.com"}, previous), true);
});
