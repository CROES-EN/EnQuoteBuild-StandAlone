import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";

async function loadModules() {
  const output = await build({
    stdin: {
      contents: `export * from "@/features/supervisorDashboard/dailySnapshotSources";
export {buildSnapshotMarkdown} from "@/features/supervisorDashboard/omSnapshotExport";`,
      resolveDir: process.cwd()
    },
    bundle: true, write: false, platform: "node", format: "esm",
    alias: {"@": path.resolve("src")},
    banner: {js: `import {createRequire as __cr} from "node:module"; const require = __cr(${JSON.stringify(path.resolve("package.json"))});`},
    // The PDF writer and API client aren't exercised here; stub them so the bundle needs no DOM/env.
    plugins: [{name: "stubs", setup(b) {
      b.onResolve({filter: /^jspdf$/}, () => ({path: "jspdf", namespace: "stub"}));
      b.onResolve({filter: /api[\\/]dataClient(\.js)?$/}, () => ({path: "dataClient", namespace: "stub"}));
      b.onLoad({filter: /^jspdf$/, namespace: "stub"}, () => ({contents: "export default class {}", loader: "js"}));
      b.onLoad({filter: /^dataClient$/, namespace: "stub"}, () => ({contents: "export const getQuotes = async () => [];", loader: "js"}));
    }}]
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}

const DATE = "2026-10-08";
const NOW = new Date("2026-10-09T09:00:00-06:00");
const eodb = (value, other = 1) => ({
  importedAt: "2026-10-09T08:00:00-06:00", sourceFileName: "eodb.xlsx",
  rows: [{Date: "O&M Skill", "2026-10-07": other, [DATE]: value - 1}, {Date: "Grand Total", "2026-10-07": other, [DATE]: value}]
});

test("daily snapshot sections come from imported reports and list missing ones", async () => {
  const {buildDailySourceSections} = await loadModules();
  const {sections, missingReports} = buildDailySourceSections({
    date: DATE, now: NOW,
    reportTables: {
      eodb_total_call_volume: eodb(200, 999),
      eodb_abandoned_calls: eodb(10, 50),
      sfdc_quotes: {importedAt: "2026-10-09T07:00:00-06:00", rows: [{"O&M Status": "Quote Requested"}, {"O&M Status": " quote requested "}, {"O&M Status": "Closed"}]}
    },
    hygiene: {date: DATE, requests: 20, flagged: 5, issues: {"Missing Site ID": 3, "No SOP note": 4, "Bad serial": 1, Other: 1}}
  });

  const titles = sections.map(section => section.title);
  assert.deepEqual(titles, ["Quote Requests", "Calls"]);
  const calls = Object.fromEntries(sections.find(section => section.title === "Calls").fields);
  assert.equal(calls["Total Interactions"], "200");
  assert.equal(calls.Abandoned, "10");
  assert.equal(calls.Handled, "190");
  assert.equal(calls["Abandonment Rate"], "5%");
  assert.equal(calls["Avg Wait Time"], null);

  const requests = Object.fromEntries(sections.find(section => section.title === "Quote Requests").fields);
  assert.equal(requests["Quotes Requested (O&M Status = Quote Requested)"], "2");
  assert.equal(requests["Flagged for Data Hygiene"], "5 (25%)");
  assert.equal(requests["Most Common Flags"], "No SOP note (4); Missing Site ID (3); Bad serial (1)");

  assert.ok(missingReports.includes("Boise O&M Staffing Report"));
  assert.ok(missingReports.includes("Salesforce Case History"));
  assert.ok(!missingReports.includes("Incorta EODB Dashboard"));
  assert.ok(!missingReports.includes("SFDC-Quotes"));
});

test("snapshot markdown leads with the executive summary and renders source sections", async () => {
  const {buildDailySourceSections, buildSnapshotMarkdown} = await loadModules();
  const {sections, missingReports} = buildDailySourceSections({
    date: DATE, now: NOW, reportTables: {eodb_total_call_volume: eodb(120), eodb_abandoned_calls: eodb(6)},
    quotes: [], backlog: {snapshot: null, live: false}
  });
  const markdown = buildSnapshotMarkdown({
    reportingDate: "Oct 8, 2026", reportingDateIso: DATE, reportingWindowLabel: "Oct 8, 2026, 12:00 AM-11:59 PM (America/Denver)",
    preparedAt: "Oct 9, 2026, 9:00 AM", sections, missingReports, notes: [],
    executiveSummaryBullets: ["Calls handled up 12 vs prior day."]
  });

  assert.match(markdown, /^# O&M Daily Operations Snapshot \u2014 Oct 8, 2026/);
  assert.ok(markdown.indexOf("## Executive Summary") < markdown.indexOf("## Quotes"));
  assert.match(markdown, /- Calls handled up 12 vs prior day\./);
  assert.match(markdown, /## Calls\n_Source: Incorta EODB Dashboard/);
  assert.match(markdown, /- \*\*Total Interactions:\*\* 120/);
  assert.match(markdown, /- \*\*Quote Backlog \(SLA alerts\):\*\* No snapshot saved for 2026-10-08/);
  assert.match(markdown, /- \*\*Quotes Created:\*\* N\/A/);
  assert.match(markdown, /## Data Notes\n- Not imported: Boise O&M Staffing Report/);
  assert.doesNotMatch(markdown, /CXone|NICE|Escalations|Final quality check/i);
});
