import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("task form saves optional identifiers, preserves leading zeros and clears stale exact case links", async () => {
  let state = [];
  let cursor = 0;
  let effects = [];
  let save;
  let saved;
  const require = createRequire(import.meta.url);
  const wrapper = ({children}) => React.createElement("div", null, children);
  const mocks = {
    react: {...React, useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => {state[index] = typeof value === "function" ? value(state[index]) : value;}];
    }, useEffect: fn => effects.push(fn), useRef: value => ({current: value})},
    sonner: {toast: {success() {}, error(message) {assert.fail(message);}}},
    "lucide-react": {FileText: () => null, Loader2: () => null, X: () => null},
    "@/features/collab/collabApi": {tasksApi: {save: async record => {saved = record;}}},
    "@/components/collab/QuotePicker": Object.assign(() => null, {quoteLabel: () => ""}),
    "@/components/ui/button": {Button: ({children, onClick}) => {
      if (React.Children.toArray(children).some(child => child === "Add task" || child === "Save")) save = onClick;
      return React.createElement("button", null, children);
    }},
    "@/components/ui/input": {Input: props => React.createElement("input", props)},
    "@/components/ui/label": {Label: props => React.createElement("label", props)},
    "@/components/ui/textarea": {Textarea: props => React.createElement("textarea", props)},
    ...Object.fromEntries([
      ["dialog", ["Dialog", "DialogContent", "DialogFooter", "DialogHeader", "DialogTitle"]],
      ["sheet", ["Sheet", "SheetContent", "SheetFooter", "SheetHeader", "SheetTitle"]],
      ["select", ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]],
      ["popover", ["Popover", "PopoverContent", "PopoverTrigger"]]
    ].map(([file, names]) => [`@/components/ui/${file}`, Object.fromEntries(names.map(name => [name, wrapper]))]))
  };
  const bundle = await build({
    entryPoints: [path.resolve("src\\components\\collab\\TaskDialog.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{name: "task-form-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(name => mocks[name] || require(name), module, module.exports);
  const render = props => {
    cursor = 0; effects = [];
    return renderToStaticMarkup(React.createElement(module.exports.default, {open: true, onOpenChange() {}, ...props}));
  };
  const task = {id: "task", title: "Existing", due_at: "2026-10-08T15:00:00.000Z", site_id: "00123", case_number: "00123456", case_id: "500existing"};
  render({task});
  effects.forEach(effect => effect());
  const html = render({task});
  assert.match(html, /id="task-site-id"[^>]*value="00123"/);
  assert.match(html, /id="task-case-number"[^>]*value="00123456"/);
  await save();
  assert.equal(saved.site_id, "00123");
  assert.equal(saved.case_number, "00123456");
  assert.equal(saved.case_id, "500existing");
  state[0] = {...state[0], site_id: " 00987 ", case_number: " 00000999 "};
  render({task});
  await save();
  assert.equal(saved.site_id, "00987");
  assert.equal(saved.case_number, "00000999");
  assert.equal(saved.case_id, null);
  state[0] = {...state[0], site_id: "", case_number: ""};
  render({task});
  await save();
  assert.equal(saved.site_id, "");
  assert.equal(saved.case_number, "");
  assert.equal(saved.case_id, null);
  state = [];
  const initial = {...task, id: undefined};
  render({initial});
  effects.forEach(effect => effect());
  render({initial});
  await save();
  assert.equal(saved.case_id, "500existing", "prefilled exact case link is preserved");
});
