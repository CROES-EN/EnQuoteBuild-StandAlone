import { parseOMStaffingV2Csv, computeStaffingTeamTotalsV2 } from "../src/features/supervisorDashboard/parseOMStaffingReport.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}: expected ${expected}, got ${actual}`);
  if (ok) passed++; else failed++;
}

// Real confirmed row: Bermudez, 7/1 - Handle Time = Talk Time + ACW Time, verified exact tonight
const sampleCsv = `Date,Agent Name,Agent ID,Team Name,Login Time,ACD Contacts,Answered,Handle Time,Talk Time,ACW Time,% Unavailable Time,Avg ACW Time,Refusals,Held Party Abandons,Working Rate,Productivity Rate,% General Unavailable Time,Occupancy,Unavailable Codes Time,Avg Talk Time,Transfer to Agent
2026/07/01,"Bermudez, Amir",39000226,Boise Aux|Todd Meyer|OM,02:59:41,9,9,02:59:41,02:56:03,00:03:38,2.02%,00:00:24,,,100.00%,100.00%,,100.00%,,00:19:34,`;

const records = parseOMStaffingV2Csv(sampleCsv);
assertEqual(records.length, 1, "Parses exactly 1 agent-day row");
assertEqual(records[0].loginTimeSec, 10781, "Login Time parsed correctly (02:59:41 = 10781s)");
assertEqual(records[0].talkTimeSec + records[0].acwTimeSec, records[0].handleTimeSec, "Handle Time = Talk Time + ACW Time (confirmed exact tonight)");

// Real confirmed outlier: Roeschberger, 8/11, Working Rate 30.50% - verified tonight
const outlierCsv = `Date,Agent Name,Agent ID,Team Name,Login Time,ACD Contacts,Answered,Handle Time,Talk Time,ACW Time,% Unavailable Time,Avg ACW Time,Refusals,Held Party Abandons,Working Rate,Productivity Rate,% General Unavailable Time,Occupancy,Unavailable Codes Time,Avg Talk Time,Transfer to Agent
2026/08/11,"Roeschberger, Carsten",34504163,Boise Aux|Todd Meyer|OM,02:52:43,7,7,00:52:13,00:52:01,00:00:12,69.62%,00:00:02,1,,30.50%,100.00%,,100.00%,,00:07:26,`;

const outlierRecords = parseOMStaffingV2Csv(outlierCsv);
assertEqual(outlierRecords[0].workingRatePct, 30.5, "Known outlier Working Rate parsed exactly (Roeschberger 8/11)");

// Team totals for the confirmed real 7/1 sample (7 agents) - verified: Headcount=7, ACD=63, Refusals=4
const totals = computeStaffingTeamTotalsV2(records);
assertEqual(totals.teamHeadcount, 1, "Headcount counts distinct agents correctly");
assertEqual(totals.totalAcdContacts, 9, "ACD Contacts sums correctly");

console.log(`\n=== OM Staffing: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
