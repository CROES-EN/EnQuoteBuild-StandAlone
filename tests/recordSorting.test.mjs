import test from "node:test";
import assert from "node:assert/strict";
import {compareRecordValues, dateSortValue, nextRecordSort, numericSortValue, sortRecords} from "../src/features/supervisorDashboard/recordSorting.js";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("Sorting toggles direction, uses numeric values, stays stable and does not mutate source records", () => {
  const rows = [{id: "a", value: 100}, {id: "b", value: null}, {id: "c", value: 2}, {id: "d", value: 2}, {id: "e", value: NaN}];
  const columns = [{key: "value", value: row => row.value}];
  const asc = nextRecordSort(null, "value");
  const desc = nextRecordSort(asc, "value");
  assert.deepEqual(sortRecords(rows, columns, asc).map(row => row.id), ["c", "d", "a", "b", "e"]);
  assert.deepEqual(sortRecords(rows, columns, desc).map(row => row.id), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(nextRecordSort(desc, "id"), {key: "id", direction: "asc"});
  assert.deepEqual(rows.map(row => row.id), ["a", "b", "c", "d", "e"]);
  assert.ok(compareRecordValues("Q-2", "Q-10", "asc") < 0);
});

test("Date and duration sort values preserve zero and put unusable values last", () => {
  assert.equal(numericSortValue("0"), 0);
  for (const value of [null, undefined, "", " ", "NaN", "invalid"]) assert.equal(numericSortValue(value), null);
  assert.ok(dateSortValue("10/5/26 11:00:00 AM") < dateSortValue("10/5/26 1:00:00 PM"));
  assert.equal(dateSortValue("invalid"), null);
  assert.equal(compareRecordValues(null, 0, "desc"), 1);
});

test("Clicking NICE headers sorts rendered records and exposes accessible sort direction", async () => {
  const require = createRequire(import.meta.url);
  let sort = null;
  const mocks = {
    react: {...React, useState: () => [sort, next => { sort = next; }]},
    "@/components/ui/table": Object.fromEntries([
      ["Table", "table"], ["TableBody", "tbody"], ["TableCell", "td"], ["TableHead", "th"], ["TableHeader", "thead"], ["TableRow", "tr"]
    ].map(([name, tag]) => [name, ({children, ...props}) => React.createElement(tag, props, children)]))
  };
  const output = await build({
    entryPoints: [path.join("src", "components", "supervisor", "NiceCallRecordsTable.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "sorting-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => mocks[name] || require(name), module, module.exports
  );
  const props = {
    records: [100, 2, null].map((wait, id) => ({
      id, outcome: "Handled", row: {"Contact ID": `call-${id}`, "Wait_Time(Sec)": wait}
    })), expected: 3, available: true, undated: 0
  };
  const render = () => renderToStaticMarkup(React.createElement(module.exports.default, props));
  function clickWait() {
    const root = module.exports.default(props);
    const table = root.props.children.find(child => child?.props?.children?.[0]?.props?.children);
    const headers = table.props.children[0].props.children.props.children;
    const elements = headers.type(headers.props);
    elements.find(element => element.key === "wait").props.children.props.onClick();
  }
  clickWait();
  let html = render();
  assert.match(html, /aria-sort="ascending"/);
  assert.deepEqual(html.match(/call-\d/g), ["call-1", "call-0", "call-2"]);
  clickWait();
  html = render();
  assert.match(html, /aria-sort="descending"/);
  assert.deepEqual(html.match(/call-\d/g), ["call-0", "call-1", "call-2"]);
});
