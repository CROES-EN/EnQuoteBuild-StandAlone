import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {build} from "esbuild";
import {buildCaseWorkReport, DEFAULT_CASE_WORK_TEAM, caseWorkDisplay} from "../src/features/supervisorDashboard/caseWorkMetrics.js";

const bundle = await build({entryPoints: [path.resolve("src\\features\\supervisorDashboard\\reportParsing.js")],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external"});
const module = {exports: {}};
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const {readWorkbookFromBytes, peekReportFile, readPeekedSheet} = module.exports;

test("Salesforce CSV paths preserve Windows-1252 names, identifiers and multiline fields", async () => {
  const header = '"Case Number","Field / Event","Old Value","New Value","Edited By","Edit Date","Subject"';
  const bytes = Buffer.concat([Buffer.from(header + '\r\n"000123","Case Owner","Alice","Outside","Jos'), Buffer.from([0xe9]),
    Buffer.from('","7/1/2026 9:00 AM","First line\nSecond line"\r\n')]);
  const workbook = readWorkbookFromBytes(bytes, "history.csv");
  const rows = workbook.getSheetRows(workbook.sheetNames[0]);
  assert.equal(rows[1][0], "000123");
  assert.equal(rows[1][4], "Jos\u00e9");
  assert.equal(rows[1][6], "First line\nSecond line");
  const peeked = await peekReportFile({name: "history.csv", arrayBuffer: async () => bytes});
  assert.deepEqual(readPeekedSheet(peeked, peeked.sheetNames[0]), rows);
  const utf8 = readWorkbookFromBytes(Buffer.from(header + '\n"000123","Case Owner","Alice","Outside","Jos\u00e9","7/1/2026 9:00 AM","Test"'), "history.csv");
  assert.equal(utf8.getSheetRows(utf8.sheetNames[0])[1][4], "Jos\u00e9");
});

test("supplied Case History is evaluated using the production CSV parser and strict metrics", {skip: !process.env.ENQUOTE_CASE_HISTORY_CSV}, async () => {
  const bytes = await readFile(process.env.ENQUOTE_CASE_HISTORY_CSV);
  const workbook = readWorkbookFromBytes(bytes, "history.csv");
  const raw = workbook.getSheetRows(workbook.sheetNames[0]);
  const headers = raw[0];
  const rows = raw.slice(1).filter(row => row.some(value => String(value).trim())).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  assert.equal(rows.length, 23248);
  const report = buildCaseWorkReport(rows, DEFAULT_CASE_WORK_TEAM);
  assert.equal(report.invalid.length, 0);
  assert.equal(report.firstDate, "2026-07-01");
  assert.equal(report.lastDate, "2026-09-30");
  const range = {start: "2026-07-01", end: "2026-09-30"};
  const totals = Object.fromEntries(["worked", "closed", "transfers", "events", "sites", "unresolved"].map(metric =>
    [metric, caseWorkDisplay(report, metric, range).value]));
  assert.deepEqual(totals, {worked: 902, closed: 160, transfers: 846, events: 1598, sites: 861, unresolved: 955});
  assert.ok(report.transfers.every(event => event.field !== "status"));
  assert.ok(report.closures.every(event => event.newValue.toLowerCase() === "closed"));
  assert.equal(caseWorkDisplay(report, "worked", {start: "2026-10-01", end: "2026-10-07"}).value, 0);
  console.log("Supplied report strict totals:", totals, "event signatures collapsed:", report.duplicates);
});
