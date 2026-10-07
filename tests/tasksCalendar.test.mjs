import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
const passthrough = ({children}) => React.createElement("div", null, children);
let tasks = [];
const mocks = {
  "@/utils": {createPageUrl: page => `/${page}`},
  "@/lib/utils": {cn: (...values) => values.filter(value => typeof value === "string").join(" ")},
  sonner: {toast: {}},
  "@/features/collab/collabApi": {useTasks: () => ({tasks, loading: false}), tasksApi: {}},
  "react-router-dom": {useLocation: () => ({search: ""}), Link: passthrough},
  "lucide-react": new Proxy({}, {get: () => () => null}),
  "@/components/collab/TaskDialog": Object.assign(() => null, {TASK_TYPES: []}),
  "@/components/links/ExternalIdLinks": {CaseNumberLink: passthrough},
  "@/components/ui/button": {Button: passthrough},
  "@/components/ui/card": {Card: passthrough, CardContent: passthrough},
  "@/components/ui/badge": {Badge: passthrough},
  "@/components/ui/checkbox": {Checkbox: () => null},
  "@/components/ui/tabs": {
    Tabs: passthrough, TabsList: passthrough, TabsTrigger: passthrough,
    TabsContent: ({value, children}) => value === "calendar" ? children : null
  },
  "@/components/ui/dropdown-menu": Object.fromEntries(
    ["DropdownMenu", "DropdownMenuContent", "DropdownMenuItem", "DropdownMenuTrigger"].map(name => [name, passthrough])
  )
};
const output = await build({
  entryPoints: [path.join("src", "pages", "Tasks.jsx")],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  jsx: "automatic", alias: {"@": path.resolve("src")},
  plugins: [{name: "calendar-boundaries", setup(builder) {
    builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path)
      ? {path: args.path, external: true} : undefined);
  }}]
});
const module = {exports: {}};
new Function("require", "module", "exports", output.outputFiles[0].text)(
  name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports
);
const render = () => renderToStaticMarkup(React.createElement(module.exports.default));
const due = new Date();
due.setHours(9, 0, 0, 0);

test("completed tasks are absent from calendar cells, overflow counts, and selected-day rows", () => {
  tasks = [
    {id: "open", title: "OPEN-TASK", due_at: due.toISOString(), status: "open"},
    ...Array.from({length: 5}, (_, index) => ({
      id: `done-${index}`, title: `COMPLETED-TASK-${index}`, due_at: due.toISOString(), status: "done"
    }))
  ];
  const html = render();
  assert.equal((html.match(/OPEN-TASK/g) || []).length, 2, "open task appears in cell and selected day");
  assert.doesNotMatch(html, /COMPLETED-TASK|5 done|\+\d+ more/);
  tasks = tasks.filter(task => task.status === "done");
  assert.match(render(), /Nothing due this day/);
  tasks[0] = {...tasks[0], status: "open"};
  assert.equal((render().match(/COMPLETED-TASK-0/g) || []).length, 2, "reopening restores both calendar surfaces");
});
