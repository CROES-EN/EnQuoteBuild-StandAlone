import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("global task shortcut opens the existing form and respects Tasks access and viewing privacy", async () => {
  let auth = {isAuthenticated: true, user: {email: "task@example.com", app_role: "admin"}};
  let policy = {loading: false, error: null, policy: {ok: true}};
  let viewing = false;
  let open = false;
  let click;
  const mocks = {
    react: {...React, useEffect() {}, useState: () => [open, value => {open = value;}]},
    "lucide-react": {ClipboardList: () => React.createElement("svg", {"data-icon": "clipboard-list"})},
    "@/lib/AuthContext": {useAuth: () => auth},
    "@/features/admin/adminApi": {useAccessPolicy: () => policy},
    "@/features/admin/readonlyViewing": {isReadonlyViewing: () => viewing},
    "./TaskDialog": ({open: visible, presentation, allowAssignment}) => visible ?
      React.createElement("div", {"data-presentation": presentation, "data-assignment": allowAssignment}, "New task form") : null
  };
  const result = await build({
    entryPoints: [path.resolve("src\\components\\collab\\NewTaskButton.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "task-shortcut-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const runtime = createRequire(import.meta.url)("react/jsx-runtime");
  mocks["react/jsx-runtime"] = {...runtime, jsx: (type, props, key) => {
    if (type === "button") click = props.onClick;
    return runtime.jsx(type, props, key);
  }};
  const module = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function("require", "module", "exports", result.outputFiles[0].text)(name => mocks[name] || require(name), module, module.exports);
  const render = () => renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(render(), /aria-label="New task"/);
  assert.match(render(), /top-16 right-4/);
  assert.match(render(), /clipboard-list/);
  click();
  assert.match(render(), /New task form/);
  assert.match(render(), /data-presentation="panel"/);
  assert.match(render(), /data-assignment="true"/);
  auth.user = {...auth.user, deny_pages: ["Messages"]};
  assert.match(render(), /data-assignment="false"/);
  auth.user = {...auth.user, deny_pages: []};
  viewing = true;
  assert.equal(render(), "");
  viewing = false;
  auth.user = {...auth.user, deny_pages: ["Tasks"]};
  assert.equal(render(), "");
  auth.user = {...auth.user, deny_pages: []};
  policy = {...policy, loading: true};
  assert.equal(render(), "");
  policy = {...policy, loading: false, error: new Error("unavailable")};
  assert.equal(render(), "");
  policy = {...policy, error: null};
  auth.isAuthenticated = false;
  assert.equal(render(), "");
});
