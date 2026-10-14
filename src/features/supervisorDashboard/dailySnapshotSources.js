// Builds the Daily Snapshot report sections from the same imported reports and live EnQuote data
// the Executive Overview tiles use, scoped to one reporting date. Pure: no React, no fetching.
import {AGGREGATION_MODES} from "./periodAggregation";
import {displayCount, displayModeRecords, quoteDisplayMetric} from "./kpiDisplayMode";
import {computeEodbWidgetTotal, getEodbWidgetRecordsFromStoredRows} from "./parseEodbWidget";
import {computeStaffingTeamTotalsV2, getRecordsFromStoredRowsV2} from "./parseOMStaffingReport";
import {computeEmailBacklogTotals, getEmailBacklogRecordsFromStoredRows, parseEmailBacklogDailyRows} from "./parseEmailBacklogReport";
import {buildCaseWorkReport, caseWorkDisplay} from "./caseWorkMetrics";
import {buildPaidQuoteReport} from "./paidQuoteMetrics";
import {describeFreshness, importFreshnessSource} from "./supervisorInsights";
import {formatNumber, formatSecondsAsClock} from "./format";

const DAY = AGGREGATION_MODES.PERIOD_TOTAL;
const QUOTE_REQUESTED = "quote requested";

const count = value => (value === null || value === undefined ? null : formatNumber(value));
const clock = seconds => (seconds === null || seconds === undefined ? null : formatSecondsAsClock(seconds));
const percent = value => (value === null || value === undefined ? null : `${value}%`);
const money = value => (value === null || value === undefined ? null
  : value.toLocaleString("en-US", {style: "currency", currency: "USD"}));

// EODB minute widgets are rounded to Incorta's one-decimal display before converting to seconds.
function eodbMinutesToSeconds(records) {
  if (!records.length) return null;
  const minutes = computeEodbWidgetTotal(records) / records.length;
  return Math.round((Math.round(minutes * 10) / 10) * 60);
}

function freshness(tables, types, name, now) {
  const result = describeFreshness(importFreshnessSource(tables, types, name), now);
  return result ? `${result.stale ? "Stale - " : ""}${result.text}` : null;
}

function callsSection(tables, range, now) {
  if (!tables.eodb_total_call_volume && !tables.eodb_abandoned_calls) return null;
  const volume = displayModeRecords(getEodbWidgetRecordsFromStoredRows(tables.eodb_total_call_volume?.rows || []), range, DAY);
  const abandonedRows = displayModeRecords(getEodbWidgetRecordsFromStoredRows(tables.eodb_abandoned_calls?.rows || []), range, DAY);
  const total = displayCount(volume, DAY);
  const abandoned = displayCount(abandonedRows, DAY);
  const handled = total !== null && abandoned !== null ? total - abandoned : null;
  const rate = total && abandoned !== null ? Math.round((abandoned / total) * 100) : null;
  return {
    title: "Calls",
    source: "Incorta EODB Dashboard",
    freshness: freshness(tables, ["eodb_total_call_volume", "eodb_abandoned_calls"], "EODB calls", now),
    fields: [
      ["Total Interactions", count(total)],
      ["Handled", count(handled)],
      ["Abandoned", count(abandoned)],
      ["Abandonment Rate", percent(rate)],
      ["Avg Wait Time", clock(eodbMinutesToSeconds(displayModeRecords(getEodbWidgetRecordsFromStoredRows(tables.eodb_daily_wait_time?.rows || []), range, DAY)))],
      ["Avg Talk Time", clock(eodbMinutesToSeconds(displayModeRecords(getEodbWidgetRecordsFromStoredRows(tables.eodb_avg_talk_time?.rows || []), range, DAY)))]
    ]
  };
}

function staffingSection(tables, range, now) {
  if (!tables.staffing) return null;
  const totals = computeStaffingTeamTotalsV2(displayModeRecords(getRecordsFromStoredRowsV2(tables.staffing.rows || []), range, DAY));
  return {
    title: "Team Staffing",
    source: "Boise O&M Staffing Report",
    freshness: freshness(tables, ["staffing"], "Staffing", now),
    fields: [
      ["Team Headcount", count(totals?.teamHeadcount)],
      ["Avg Team Utilization", percent(totals?.avgWorkingRatePct)],
      ["Total Contacts Handled", count(totals?.totalAcdContacts)],
      ["Avg Talk Time", clock(totals?.avgTalkTimeSec)],
      ["Avg ACW Time", clock(totals?.avgAcwTimeSec)],
      ["Refusals", count(totals?.totalRefusals)],
      ["Held Party Abandons", count(totals?.totalHeldPartyAbandons)],
      ["Transfer to Agent", count(totals?.totalTransferToAgent)]
    ]
  };
}

function emailSection(tables, range, now) {
  if (!tables.email_daily && !tables.email_cases) return null;
  const daily = displayModeRecords(parseEmailBacklogDailyRows(tables.email_daily?.rows || []), range, DAY);
  const totals = computeEmailBacklogTotals(daily, getEmailBacklogRecordsFromStoredRows(tables.email_cases?.rows || []));
  const aging = totals.agingBuckets;
  const fields = [];
  if (tables.email_daily) {
    fields.push(["Total Emails", daily.length ? count(totals.totalEmails) : null]);
    fields.push(["Avg Handle Time", totals.avgHandleTimeHours === null ? null : clock(Math.round(totals.avgHandleTimeHours * 3600))]);
  }
  if (tables.email_cases) {
    fields.push(["Open Backlog (current)", `${formatNumber(totals.openBacklogCount)} (0-7d: ${aging.days0to7}, 8-14d: ${aging.days8to14}, 15-30d: ${aging.days15to30}, 30+d: ${aging.days30plus})`]);
    fields.push(["Oldest Open Case", totals.oldestOpenAgeDays === null ? null : `${Math.floor(totals.oldestOpenAgeDays)} days`]);
  }
  return {
    title: "Email",
    source: "Incorta O&M Email Report",
    freshness: freshness(tables, [tables.email_daily && "email_daily", tables.email_cases && "email_cases"].filter(Boolean), "Email report", now),
    fields
  };
}

function backlogText(backlog, date) {
  if (!backlog) return null;
  if (backlog.error) return `Unavailable - ${backlog.error}`;
  const snapshot = backlog.snapshot;
  if (!snapshot) return `No snapshot saved for ${date}`;
  const overdue = (snapshot.rows || []).filter(row => row.alert?.overdueHours > 0).length;
  return `${formatNumber(snapshot.count)} (${formatNumber(overdue)} overdue${backlog.live ? ", live" : ""})`;
}

function quotesSection({quotes, lifecycle, backlog, range, date}) {
  if (!quotes) return null;
  const paid = buildPaidQuoteReport(quotes, range, DAY);
  return {
    title: "Quotes",
    source: "EnQuote (live)",
    freshness: "Live from EnQuote",
    fields: [
      ["Quotes Created", lifecycle ? count(quoteDisplayMetric(lifecycle, "created", range, DAY).value) : null],
      ["Quotes Worked", lifecycle ? count(quoteDisplayMetric(lifecycle, "worked", range, DAY).value) : null],
      ["Quote Backlog (SLA alerts)", backlogText(backlog, date)],
      ["Invoices Paid", count(paid.count)],
      ["Paid Quote Total", money(paid.amount)]
    ]
  };
}

function requestsSection(tables, hygiene, now) {
  const sfdc = tables.sfdc_quotes;
  if (!sfdc && !tables.quoteRequestCases && !hygiene) return null;
  const fields = [];
  if (sfdc) {
    const requested = (sfdc.rows || []).filter(row => String(row["O&M Status"] ?? "").trim().toLowerCase() === QUOTE_REQUESTED).length;
    fields.push(["Quotes Requested (O&M Status = Quote Requested)", count(requested)]);
  }
  if (hygiene) {
    const rate = hygiene.requests ? Math.round((hygiene.flagged / hygiene.requests) * 100) : 0;
    fields.push(["Request Cases Reviewed", count(hygiene.requests)]);
    fields.push(["Flagged for Data Hygiene", `${formatNumber(hygiene.flagged)} (${rate}%)`]);
    const top = Object.entries(hygiene.issues || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    if (top.length) fields.push(["Most Common Flags", top.map(([issue, cases]) => `${issue} (${cases})`).join("; ")]);
  } else if (tables.quoteRequestCases) {
    fields.push(["Data Hygiene", "No hygiene review saved for this date"]);
  }
  const types = [sfdc && "sfdc_quotes", tables.quoteRequestCases && "quoteRequestCases"].filter(Boolean);
  return {
    title: "Quote Requests",
    source: [sfdc && "SFDC-Quotes", tables.quoteRequestCases && "Quote Request Cases with Case Comments"].filter(Boolean).join(" + ") || "Saved hygiene review",
    freshness: types.length ? freshness(tables, types, "Quote request reports", now) : null,
    fields
  };
}

function caseWorkSection(tables, range, team, now) {
  if (!tables.case_history) return null;
  const report = buildCaseWorkReport(tables.case_history.rows || [], team);
  const metric = name => count(caseWorkDisplay(report, name, range, DAY).value);
  return {
    title: "Case Work",
    source: "Salesforce Case History",
    freshness: freshness(tables, ["case_history"], "Case history", now),
    fields: [
      ["Cases Worked", metric("worked")],
      ["Cases Closed", metric("closed")],
      ["Cases Transferred Out", metric("transfers")],
      ["Case Work Events", metric("events")]
    ]
  };
}

export const SNAPSHOT_REPORTS = [
  {name: "Incorta EODB Dashboard", types: ["eodb_total_call_volume", "eodb_abandoned_calls"]},
  {name: "Boise O&M Staffing Report", types: ["staffing"]},
  {name: "Incorta O&M Email Report", types: ["email_daily", "email_cases"]},
  {name: "SFDC-Quotes", types: ["sfdc_quotes"]},
  {name: "Quote Request Cases with Case Comments", types: ["quoteRequestCases"]},
  {name: "Salesforce Case History", types: ["case_history"]}
];

/**
 * @param {object} input
 * @param {string} input.date YYYY-MM-DD reporting date.
 * @param {object} input.reportTables Imported report tables keyed by report type.
 * @param {object[]|null} input.quotes EnQuote quotes (null while unavailable).
 * @param {object|null} input.lifecycle buildQuoteLifecycleReport result for the date.
 * @param {object|null} input.backlog {snapshot, live} or {error}.
 * @param {object|null} input.hygiene Hygiene snapshot for the date.
 * @param {string[]} input.caseWorkTeam Team names for case-work attribution.
 */
export function buildDailySourceSections({date, reportTables = {}, quotes = null, lifecycle = null, backlog = null, hygiene = null, caseWorkTeam = [], now = new Date()} = {}) {
  const tables = reportTables || {};
  const range = {start: date, end: date};
  const sections = [
    quotesSection({quotes, lifecycle, backlog, range, date}),
    requestsSection(tables, hygiene, now),
    caseWorkSection(tables, range, caseWorkTeam, now),
    callsSection(tables, range, now),
    staffingSection(tables, range, now),
    emailSection(tables, range, now)
  ].filter(Boolean);
  const missingReports = SNAPSHOT_REPORTS.filter(report => !report.types.some(type => tables[type])).map(report => report.name);
  return {sections, missingReports};
}
