import test from "node:test";
import assert from "node:assert/strict";
import {niceCallContributingRecords, quoteContributingRecords} from "../src/features/supervisorDashboard/contributingRecords.js";
import {buildQuoteLifecycleReport} from "../src/features/quoteDashboard/quoteLifecycle.js";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

test("Quote drill-down lists match tile totals and retain all qualifying events per unique quote", () => {
  const report = buildQuoteLifecycleReport([
    {id: "q1", created_date: "2026-10-01T12:00:00", status: "approved", status_history: [
      {status: "draft", changed_at: "2026-10-01T12:00:00"},
      {status: "approved", changed_at: "2026-10-02T12:00:00"},
      {status: "approved", changed_at: "2026-10-03T12:00:00", entry_type: "follow_up"}
    ]},
    {id: "q2", created_date: "2026-10-02T12:00:00", status: "draft", status_history: [
      {status: "draft", changed_at: "2026-10-02T12:00:00"}
    ]}
  ], {now: Date.parse("2026-10-06T12:00:00"), range: {start: "2026-10-02", end: "2026-10-03"}});
  const created = quoteContributingRecords(report, "created");
  const worked = quoteContributingRecords(report, "worked");
  assert.equal(created.length, report.newQuotes);
  assert.equal(worked.length, report.workedQuotes);
  assert.equal(created[0].quote.id, "q2");
  assert.equal(worked[0].quote.id, "q1");
  assert.deepEqual(worked[0].events.map(event => event.kind), ["follow_up", "transition"]);
});

test("NICE drill-down uses local PST dates and explicit call flags, not NaN agent names", () => {
  const rows = [
    {"Contact Start Time (PST)": "10/5/26 11:59:59 PM", "Contactstartdatetime(UTC)": "10/6/26 6:59:59 AM", Contactagentname: "Agent", Abandons: "1"},
    {"Contact Start Time (PST)": "10/5/26 12:00:00 AM", Contactagentname: "NaN", Handled: "1"},
    {"Contact Start Time (PST)": "10/6/26 12:00:00 AM", Abandons: "1"},
    {"Contact Start Time (PST)": "10/5/26 9:00:00 AM"},
    {"Contact Start Time (PST)": "invalid", Abandons: "1"}
  ];
  const result = niceCallContributingRecords(rows, {start: "2026-10-05", end: "2026-10-05"});
  assert.deepEqual(result.records.map(record => record.outcome), ["Abandoned", "Handled", "Unclassified"]);
  assert.equal(result.undated, 1);
  assert.deepEqual(result.records[0].row, rows[0]);
});

test("Raw call drill-down explicitly displays the October 5 coverage gap without fabricating a 23rd call", async () => {
  const require = createRequire(import.meta.url);
  const passthrough = ({children}) => React.createElement("div", null, children);
  const mocks = {
    "@/components/ui/table": Object.fromEntries(["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"].map(name => [name, passthrough]))
  };
  const output = await build({
    entryPoints: [path.join("src", "components", "supervisor", "NiceCallRecordsTable.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "table-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => mocks[name] || require(name), module, module.exports
  );
  const records = Array.from({length: 22}, (_, id) => ({
    id, outcome: "Abandoned",
    row: {"Contact ID": `call-${id}`, "Contact Start Time (PST)": "10/5/26 9:00:00 AM", Abandons: "1"}
  }));
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {records, expected: 23, undated: 0, available: true}));
  assert.match(html, /EODB report counts 23 calls; NICE raw data contains 22 matching records/);
  assert.match(html, /Missing records are not fabricated/);
  assert.equal((html.match(/call-\d+/g) || []).length, 22);
});
