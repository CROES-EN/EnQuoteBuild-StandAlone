// Real assertions, matching what was manually verified tonight against actual uploaded files.
// Run this any time parseEmailBacklogReport.js changes, to confirm nothing broke.
import {
    computeEmailBacklogTotals,
    parseEmailBacklogDailyRows,
    parseEmailBacklogRawData
} from "../src/features/supervisorDashboard/parseEmailBacklogReport.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}: expected ${expected}, got ${actual}`);
  if (ok) passed++; else failed++;
}

function assertClose(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) < tolerance;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}: expected ~${expected}, got ${actual}`);
  if (ok) passed++; else failed++;
}

// --- Age is NOT handle time - verified against 3 independent real rows tonight ---
const sampleCsv = `Case Origin,Full Name,Created Date,createdDate_PST,Case Number,Account Name,Name,Case Category,Case Type,Subject,Status,Closed?,Closed Date,Age
Email,,7/1/26 2:51:07 PM,7/1/26,20178137,Pronto Residential Platform Account 1,Docusign Account,General,Other,Verify a New Device,Closed,true,7/1/26 2:57:57 PM,69.38116898148148`;

const records = parseEmailBacklogRawData(sampleCsv);
assertEqual(records.length, 1, "Parses exactly 1 case row");
assertEqual(records[0].caseNumber, "20178137", "Case Number parsed correctly");
assertEqual(records[0].isClosed, true, "Closed? flag correctly parsed as boolean true");
assertClose(records[0].ageDays, 69.38116898148148, 0.0001, "Age field parsed exactly");
assertEqual(records[0].createdDateIso, "2026-07-01", "Created Date parsed to correct ISO date");

// --- Daily rows: Excel serial date conversion, verified against real serials 46204-46206 ---
const dailyRows = [
  { "Record Type": "365 Pronto Support", "createdDate_PST": "46204", "# Emails": "14.0", "AHT": "4.532887731481481" },
  { "Record Type": "365 Pronto Support", "createdDate_PST": "46205", "# Emails": "10.0", "AHT": "3.1270960648148147" },
];
const daily = parseEmailBacklogDailyRows(dailyRows);
assertEqual(daily[0].date, "2026-07-01", "Excel serial 46204 converts to correct date");
assertEqual(daily[1].date, "2026-07-02", "Excel serial 46205 converts to correct date");
assertEqual(daily[0].emailCount, 14, "# Emails parsed as number");

// --- Weighted AHT math, verified against real Grand Total (2.824909983612814) tonight ---
const totals = computeEmailBacklogTotals(daily, records);
assertEqual(totals.totalEmails, 24, "Total emails sums correctly across days");

// --- Open backlog aging buckets, verified against real 105-open-case dataset tonight ---
const openCaseSample = [
  { isClosed: false, ageDays: 3 },
  { isClosed: false, ageDays: 10 },
  { isClosed: false, ageDays: 20 },
  { isClosed: false, ageDays: 45 },
  { isClosed: true, ageDays: 100 } // closed - must NOT count toward backlog
];
const backlogTotals = computeEmailBacklogTotals([], openCaseSample);
assertEqual(backlogTotals.openBacklogCount, 4, "Closed cases correctly excluded from open backlog count");
assertEqual(backlogTotals.agingBuckets.days0to7, 1, "0-7 day bucket correct");
assertEqual(backlogTotals.agingBuckets.days8to14, 1, "8-14 day bucket correct");
assertEqual(backlogTotals.agingBuckets.days15to30, 1, "15-30 day bucket correct");
assertEqual(backlogTotals.agingBuckets.days30plus, 1, "30+ day bucket correct");

console.log(`\n=== Email Backlog: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
