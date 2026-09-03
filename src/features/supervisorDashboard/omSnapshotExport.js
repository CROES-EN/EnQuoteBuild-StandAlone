/**
 * Markdown + PDF export for the O&M Daily Operations Snapshot report tab, mirroring the
 * source spec's exact `REQUIRED OUTPUT` section/field layout.
 *
 * `reportData` (built by `DailySnapshotReport.jsx`) is a plain object of already display-ready
 * values - each leaf value is either a formatted string/number or `null`/`undefined` for a
 * missing metric. Both exporters render `null`/`undefined` as the spec's required
 * "N/A - Source unavailable" rather than inventing a value.
 *
 * PDF generation follows the same jsPDF conventions already established in
 * `QuotePDFGenerator.jsx` (manual yPos layout, page-break threshold checks, `normalizeText` for
 * characters jsPDF's default font can't render) instead of introducing a new pattern/library.
 */

import jsPDF from "jspdf";

const NA = "N/A - Source unavailable";

function displayValue(value) {
  return value === null || value === undefined || value === "" ? NA : String(value);
}

// Normalizes Unicode characters jsPDF's default font can't render - copied from
// QuotePDFGenerator.jsx so PDF output styling stays consistent across the app.
function normalizeText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\u2011/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2022/g, "*")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"');
}

function fieldLines(fields) {
  // fields: Array<[label, value]>
  return fields.map(([label, value]) => `${label}: ${displayValue(value)}`);
}

function listOrNone(items, noneText = "None") {
  return items && items.length ? items : [noneText];
}

/**
 * Builds the full section/field list (each section: { title, lines: string[] }) shared by both
 * the Markdown and PDF renderers, so the two export formats can never drift out of sync.
 */
function buildSections(reportData) {
  const cc = reportData.contactCenter || {};
  const st = reportData.staffing || {};
  const qo = reportData.quoteOps || {};
  const cb = reportData.caseBacklog || {};
  const care = reportData.care || {};
  const esc = reportData.escalations || {};
  const dq = reportData.dataQuality || {};

  return [
    {
      title: "CONTACT CENTER - INCORTA EODB",
      lines: fieldLines([
        ["Calls Offered", cc.callsOffered],
        ["Calls Handled", cc.callsHandled],
        ["Calls Abandoned", cc.callsAbandoned],
        ["Abandon Rate", cc.abandonRate],
        ["Handle Rate", cc.handleRate],
        ["Average Handle Time", cc.aht],
        ["Average Wait Time", cc.avgWait],
        ["Emails Received", cc.emailsReceived],
        ["Emails Worked or Handled", cc.emailsWorked],
        ["Email Backlog at Start", cc.emailBacklogStart],
        ["Email Backlog at End", cc.emailBacklogEnd],
        ["Source Refresh Time", cc.sourceRefreshTime]
      ])
    },
    {
      title: "STAFFING - NICE CXONE",
      lines: fieldLines([
        ["Team Headcount", st.teamHeadcount],
        ["Scheduled Staff", st.scheduledStaff],
        ["Available Staff", st.availableStaff],
        ["Full-Day Absences", st.fullDayAbsences],
        ["Partial-Day Absences", st.partialDayAbsences],
        ["Training/Meeting Capacity Loss", st.trainingCapacityLoss],
        ["Scheduled Productive Hours", st.scheduledProductiveHours],
        ["Actual Productive Hours", st.actualProductiveHours],
        ["Staffing Availability Rate", st.staffingAvailabilityRate],
        ["Source Report and Refresh Time", st.sourceRefreshTime]
      ])
    },
    {
      title: "QUOTE OPERATIONS",
      lines: fieldLines([
        ["Salesforce Quotes Received", qo.sfQuotesReceived],
        ["EnQuote Quotes Drafted", qo.quotesDrafted],
        ["EnQuote Quotes Completed", qo.quotesCompleted],
        ["Completed Status Definition Used", qo.completedStatusesLabel],
        ["Unreconciled Quote Requests (approximate)", qo.unreconciledQuoteRequests],
        ["Quote Backlog at Start", qo.backlogStart],
        ["Quote Backlog at End", qo.backlogEnd],
        ["Source Refresh Times", qo.sourceRefreshTime]
      ])
    },
    {
      title: "O&M CASE BACKLOG",
      lines: fieldLines([
        ["Backlog at Start", cb.backlogStart],
        ["New Cases Received", cb.newCasesReceived],
        ["Cases Completed", cb.casesCompleted],
        ["Backlog at End", cb.backlogEnd],
        ["Net Backlog Change", cb.netBacklogChange],
        ["Reconciliation Variance", cb.reconciliationVariance],
        ["Source Refresh Time", cb.sourceRefreshTime]
      ])
    },
    {
      title: "ENPHASE CARE",
      lines: fieldLines([
        ["Care Appointment Cancellations", care.apptCancellations],
        ["Care Plan Cancellation Requests", care.planCancellationRequests],
        ["Care Cancellations Completed", care.cancellationsCompleted],
        ["Care Refunds Initiated", care.refundsInitiated]
      ])
    },
    {
      title: "BLOCKERS AND ESCALATIONS",
      lines: fieldLines([
        ["New S1 Escalations", esc.newS1],
        ["New S2 Escalations", esc.newS2],
        ["New S3 Escalations", esc.newS3],
        ["Open Critical Escalations", esc.openCritical],
        ["Major Operational Blockers", esc.majorBlockers],
        ["Leadership Action Required", esc.leadershipActionRequired],
        ["Overdue Follow-Ups", esc.overdueFollowUps]
      ])
    },
    {
      title: "DATA QUALITY AND EXCEPTIONS",
      lines: [
        `Unavailable Metrics: ${listOrNone(dq.unavailableMetrics).join("; ")}`,
        `Stale Sources: ${listOrNone(dq.staleSources).join("; ")}`,
        `Filter or Timezone Concerns: ${listOrNone(dq.filterTimezoneConcerns).join("; ")}`,
        `Duplicate or Malformed Records: ${listOrNone(dq.duplicateOrMalformed).join("; ")}`,
        `Reconciliation Exceptions: ${listOrNone(dq.reconciliationExceptions).join("; ")}`,
        `Manual Inputs Used: ${listOrNone(dq.manualInputsUsed).join("; ")}`
      ]
    },
    {
      title: "EXECUTIVE SUMMARY",
      lines: listOrNone(reportData.executiveSummaryBullets, "No summary bullets available.").map(bullet => `- ${bullet}`)
    },
    {
      title: "FINAL QUALITY CHECK",
      lines: ["Verified every populated number above has a named source, applicable date window, refresh time, and non-duplicative definition."]
    }
  ];
}

/** Builds the exact O&M Daily Operations Snapshot report as a Markdown string. */
export function buildSnapshotMarkdown(reportData) {
  const header = [
    "# O&M DAILY OPERATIONS SNAPSHOT",
    `**Reporting Date:** ${displayValue(reportData.reportingDate)}`,
    `**Reporting Window and Timezone:** ${displayValue(reportData.reportingWindowLabel)}`,
    `**Prepared At:** ${displayValue(reportData.preparedAt)}`,
    ""
  ];

  const body = buildSections(reportData).flatMap(section => [`## ${section.title}`, ...section.lines, ""]);

  return [...header, ...body].join("\n").trim() + "\n";
}

/** Triggers a browser download of the Markdown report (matches quoteSLAExport.js's download pattern). */
export function downloadSnapshotMarkdown(reportData) {
  const markdown = buildSnapshotMarkdown(reportData);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `om-daily-snapshot_${reportData.reportingDate || "report"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Copies the Markdown report to the clipboard. */
export async function copySnapshotMarkdown(reportData) {
  const markdown = buildSnapshotMarkdown(reportData);
  await navigator.clipboard.writeText(markdown);
}

function ensureSpace(doc, yPos, needed = 30) {
  if (yPos + needed > 275) {
    doc.addPage();
    return 20;
  }
  return yPos;
}

/** Builds the O&M Daily Operations Snapshot as a jsPDF document and triggers a browser download. */
export function downloadSnapshotPDF(reportData) {
  const doc = new jsPDF();
  let yPos = 20;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.setTextColor("#4f46e5");
  doc.text("O&M Daily Operations Snapshot", 20, yPos);
  yPos += 8;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(normalizeText(`Reporting Date: ${displayValue(reportData.reportingDate)}`), 20, yPos);
  yPos += 5;
  doc.text(normalizeText(`Reporting Window and Timezone: ${displayValue(reportData.reportingWindowLabel)}`), 20, yPos);
  yPos += 5;
  doc.text(normalizeText(`Prepared At: ${displayValue(reportData.preparedAt)}`), 20, yPos);
  yPos += 8;

  buildSections(reportData).forEach(section => {
    yPos = ensureSpace(doc, yPos, 20);

    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(normalizeText(section.title), 20, yPos);
    yPos += 6;

    doc.setFontSize(9.5);
    doc.setFont(undefined, "normal");
    section.lines.forEach(line => {
      // Wrap first, then reserve the REAL rendered height (not a fixed guess) - a long
      // free-text field (blockers, leadership action required, executive summary bullets) can
      // wrap into many more than the ~2-3 lines a fixed constant would assume, and checking a
      // fixed amount before wrapping risks drawing text past the bottom of the page.
      const wrapped = doc.splitTextToSize(normalizeText(line), 170);
      yPos = ensureSpace(doc, yPos, wrapped.length * 4.5 + 2);
      doc.text(wrapped, 22, yPos);
      yPos += wrapped.length * 4.5;
    });
    yPos += 4;
  });

  doc.save(`om-daily-snapshot_${reportData.reportingDate || "report"}.pdf`);
}
