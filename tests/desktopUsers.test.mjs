import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);

async function loadUsers(source) {
  const state = [], queries = [], mutations = [], buttons = new Map(), inputs = new Map(), forms = [];
  const calls = [], errors = [], successes = [];
  const users = [{id: "admin", email: "admin@example.invalid", app_role: "admin"}];
  let cursor = 0, mutationIndex = 0, completion, failure = null;
  const wrapper = ({children}) => React.createElement("div", null, children);
  const roleGuard = Object.assign(wrapper, {useUserRole: () => ({user: users[0], isAdmin: true})});
  const runtime = require("react/jsx-runtime");
  const jsx = name => (type, props, key) => {
    if (type === "form") forms.push(props.onSubmit);
    return runtime[name](type, props, key);
  };
  const mocks = {
    react: {...React, useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => {state[index] = typeof value === "function" ? value(state[index]) : value;}];
    }},
    "react/jsx-runtime": {...runtime, jsx: jsx("jsx"), jsxs: jsx("jsxs")},
    "@tanstack/react-query": {
      useQueryClient: () => ({invalidateQueries() {}, setQueryData() {}}),
      useQuery: options => {
        queries.push(options);
        return {data: options.queryKey[0] === "users" ? users : [], isLoading: false, error: null};
      },
      useMutation: options => {
        mutations[mutationIndex++] = options;
        return {isPending: false, mutate: payload => {
          completion = options.mutationFn(payload).then(options.onSuccess, options.onError);
        }};
      }
    },
    "@/api/base44Client": {base44: {
      get entities() {
        assert.equal(source, "base44", "desktop must never access Base44 Invitation");
        return {Invitation: {filter: async () => [], create: async payload => calls.push(["invitation", payload])}};
      },
      users: {inviteUser: async (...args) => calls.push(["invite", ...args])}
    }},
    "@/features/admin/adminApi": {
      overview: async () => ({ok: true, users}),
      setUserOverride: async payload => {
        if (failure) throw new Error(failure);
        calls.push(["override", payload]);
        return {ok: true};
      }
    },
    "@/api/dataClient": {getUsers: async () => users, updateLocalRecord() {}},
    "@/components/auth/RoleGuard": roleGuard,
    "@/features/admin/AdminMenu": () => null,
    "@/components/users/UserCard": () => null,
    "@/components/users/UserForm": () => null,
    "@/lib/utils": {cn: (...args) => args.filter(Boolean).join(" ")},
    "lucide-react": new Proxy({}, {get: () => () => null}),
    sonner: {toast: {error: message => errors.push(message), success: message => successes.push(message)}},
    "@/components/ui/input": {Input: props => {inputs.set(props.id, props); return React.createElement("input", props);}},
    "@/components/ui/button": {Button: props => {
      const label = React.Children.toArray(props.children).filter(value => typeof value === "string").join("");
      buttons.set(label, props);
      return React.createElement("button", null, props.children);
    }},
    ...Object.fromEntries([
      ["card", ["Card"]], ["label", ["Label"]],
      ["dialog", ["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"]],
      ["sheet", ["Sheet", "SheetContent", "SheetDescription", "SheetHeader", "SheetTitle"]],
      ["select", ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]]
    ].map(([file, names]) => [`@/components/ui/${file}`, Object.fromEntries(names.map(name =>
      [name, name === "Sheet" || name === "Dialog" ? ({open, children}) => open ? wrapper({children}) : null : wrapper]
    ))]))
  };
  const bundle = await build({
    entryPoints: [path.resolve("src\\pages\\Users.jsx")], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    define: {"import.meta.env.VITE_DATA_SOURCE": JSON.stringify(source)},
    plugins: [{name: "users-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(name => mocks[name] || require(name), module, module.exports);
  const render = () => {
    cursor = 0; mutationIndex = 0; queries.length = 0; forms.length = 0; buttons.clear(); inputs.clear();
    return renderToStaticMarkup(React.createElement(module.exports.default));
  };
  return {render, queries, mutations, buttons, inputs, forms, calls, errors, successes,
    complete: () => completion, fail: message => {failure = message;}};
}

test("desktop creates normalized email access without invitations; errors keep the populated form open", async () => {
  const ui = await loadUsers("local");
  assert.doesNotMatch(ui.render(), /Send Invite/);
  assert.equal(ui.queries.find(query => query.queryKey[0] === "invitations").enabled, false);
  assert.equal((await ui.queries[0].queryFn()).length, 1);
  ui.buttons.get("Create User").onClick();
  assert.match(ui.render(), /Company Sign-in/);
  assert.equal(ui.inputs.has("create_name"), false);
  ui.inputs.get("create_email").onChange({target: {value: "  NEW@Example.Invalid  "}});
  ui.render();
  ui.fail("Service unavailable");
  ui.forms[0]({preventDefault() {}});
  await ui.complete();
  assert.deepEqual(ui.errors, ["Service unavailable"]);
  assert.match(ui.render(), /NEW@Example.Invalid/);
  assert.equal(ui.successes.length, 0);
  ui.fail(null);
  ui.forms[0]({preventDefault() {}});
  await ui.complete();
  assert.deepEqual(ui.calls, [["override", {
    email: "new@example.invalid", app_role: "submitter", additional_roles: [], allow_pages: [], deny_pages: []
  }]]);
  assert.match(ui.successes[0], /no invitation email was sent/);
  assert.doesNotMatch(ui.render(), /Company Sign-in/);
});

test("hosted Base44 retains its invitation API and controls", async () => {
  const ui = await loadUsers("base44");
  assert.match(ui.render(), /Send Invite/);
  assert.equal(ui.queries.find(query => query.queryKey[0] === "invitations").enabled, true);
  await ui.mutations[1].mutationFn({email: "USER@Example.Invalid", role: "approver"});
  assert.equal(ui.calls[0][0], "invitation");
  assert.deepEqual(ui.calls[1], ["invite", "user@example.invalid", "user"]);
});
