/**
 * Configurable "report definition" registry for the Supervisor Dashboard's Import Center.
 *
 * Modeled on the O&M Daily Operations Snapshot report inventory - each entry here describes
 * one importable report type: what it's for, where it comes from, which columns it can fill
 * in, and which dashboard tab(s) its data drives. This registry never invents a source-system
 * schema - the six `schemaStatus: "configured"` entries below reuse exactly the column
 * aliases/groups already implemented and tested in `reportParsing.js` (FIELD_DEFINITIONS), and
 * their "source system"/"expected report name" text is drawn only from what's already
 * documented and confirmed in `ReportInventory.jsx`. The remaining report types named in the
 * O&M reporting spec (Quote Approval & Payment, Field Service Appointment, Work Order, Labor/
 * Travel/Mileage, Product & Material Usage, Product Catalog Exception, Revenue) have no
 * representative source file in this repository, so they're listed as `schemaStatus:
 * "setup_required"` stubs only - import is intentionally blocked for those until an
 * administrator configures their real columns.
 */

import {FIELD_DEFINITIONS} from "./reportParsing";

export const REPORT_DEFINITIONS = [
  {
    reportTypeId: "cxone",
    displayName: "Contact Center Report",
    purpose: "Daily call and email queue performance for the O&M contact center - offered/handled/abandoned calls, handle time, wait time, and email volume.",
    sourceSystem: "Incorta EODB Dashboard - Pronto/ISR Team (primary source). Export a NICE CXONE contact/queue report only for a measure that dashboard doesn't show.",
    sourceLink: "https://enphase-1.cloud2.incorta.com/incorta/!enphase/#/dashboard/3f49ad7f-2ed3-46e6-a91e-c201a592d2d9/tab/8aa4d1fb-84c4-4a99-b073-dcf1f198b318",
    acceptedFileTypes: [".xlsx", ".xls", ".csv", ".html", ".htm"],
    expectedFileNames: ["Contact Summary", "Skill or Queue Performance", "Inbound Contact Performance", "Abandon Analysis", "Service Level", "Contact History", "Digital or Email Contact Summary"],
    expectedSheetNames: ["ISR_INBOUND", "ISR_OUTBOUND", "ISR_EMAIL CASES", "ISR Call Login Metrics", "O&M Call Login Metrics"],
    fieldGroups: ["Contact Center"],
    dashboardsAffected: ["Contact Center", "Dashboard", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "Calls Handled", target: "Calls Handled" },
      { source: "AHT (sec)", target: "Average Handle Time" },
      { source: "Abandoned Calls", target: "Calls Abandoned" }
    ],
    importNotes: "Also accepts Incorta's \"Export to HTML\" dashboard dump directly - choose which named tab(s) (e.g. \"ISR_INBOUND\") to import; every other tab in the file is left alone.",
    schemaStatus: "configured",
    enabled: true
  },
  {
    reportTypeId: "nice_wfm",
    displayName: "Staffing / Workforce Management Report",
    purpose: "Daily team headcount, scheduled vs. available staff, absences, and productive hours.",
    sourceSystem: "NICE CXONE Workforce Management (manual CSV export - no live connection).",
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".xls", ".csv"],
    expectedFileNames: ["Published Schedule or Agent Schedule", "Schedule Summary", "Intraday Staffing", "Time-Off or Activity Summary", "Schedule Adherence", "Staffing by Interval", "Agent State or Agent Activity"],
    expectedSheetNames: [],
    fieldGroups: ["Staffing"],
    dashboardsAffected: ["Staffing", "Dashboard", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "Scheduled Staff", target: "Scheduled Staff" },
      { source: "Available Staff", target: "Available Staff (present)" },
      { source: "Full Day Absences", target: "Full-Day Absences" }
    ],
    schemaStatus: "configured",
    enabled: true
  },
  {
    reportTypeId: "salesforce",
    displayName: "Quote Request Cases Report",
    purpose: "New quote demand received from the field - how many quote-request cases came in for the day.",
    sourceSystem: "Salesforce - Quote Request Cases with Case Comments.",
    sourceLink: "https://enphase.lightning.force.com/lightning/r/Report/00OPs000007cj89MAA/view?queryScope=userFolders",
    acceptedFileTypes: [".xlsx", ".xls", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: ["Quote Operations"],
    dashboardsAffected: ["Quote Operations", "Dashboard", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "Quote Requests", target: "Salesforce Quotes Received" }
    ],
    schemaStatus: "configured",
    enabled: true
  },
  {
    reportTypeId: "incorta",
    displayName: "O&M Case Backlog Report",
    purpose: "Open O&M case backlog at the start/end of day, new cases received, and cases completed.",
    sourceSystem: "Incorta O&M Scheduling Dashboard (primary source), or O&M-Case-Tracker-v2.xlsx / O&M Case Tracking Report.xlsx as supporting validation exports.",
    sourceLink: "https://enphase-1.cloud2.incorta.com/incorta/!enphase/#/dashboard/eb5129c3-c29f-4eb6-81ab-acda2fc012b3/tab/c060b40d-e934-428d-9ebe-4f9fde5b73cf",
    acceptedFileTypes: [".xlsx", ".xls", ".csv", ".html", ".htm"],
    expectedFileNames: [],
    expectedSheetNames: ["O&M Summary", "Active Case Review", "P50/P95 Metrics"],
    fieldGroups: ["O&M Case Backlog"],
    dashboardsAffected: ["Case Backlog", "Dashboard", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "Backlog at Start", target: "Case Backlog at Start" },
      { source: "Cases Completed", target: "Cases Completed" }
    ],
    importNotes: "Also accepts Incorta's \"Export to HTML\" dashboard dump directly - choose which named tab(s) (e.g. \"O&M Summary\") to import; every other tab in the file is left alone. Skip tabs explicitly named \"Don't Use\" in the export.",
    schemaStatus: "configured",
    enabled: true
  },
  {
    reportTypeId: "care_tracker",
    displayName: "Enphase Care / SVCancelTracker Report",
    purpose: "Care field-service appointment cancellations and Care plan cancellation requests/completions/refunds.",
    sourceSystem: "EnQuote SVCancelTracker export.",
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".xls", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: ["Enphase Care"],
    dashboardsAffected: ["Enphase Care", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "Appointment Cancellations", target: "Care Appointment Cancellations" },
      { source: "SV Cancellations", target: "Care Plan Cancellation Requests" }
    ],
    schemaStatus: "configured",
    enabled: true
  },
  {
    reportTypeId: "escalations_tracker",
    displayName: "Blockers & Escalations Report",
    purpose: "New/open severity-1/2/3 escalations and overdue follow-ups.",
    sourceSystem: "O&M Tracker (desktop only).xlsm, per the O&M Escalation Workflow & SOP.",
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".xls", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: ["Blockers & Escalations"],
    dashboardsAffected: ["Escalations", "Daily Snapshot Report"],
    exampleMappings: [
      { source: "S1 Escalations", target: "New S1 Escalations" },
      { source: "Open Critical", target: "Open Critical Escalations" }
    ],
    schemaStatus: "configured",
    enabled: true
  },

  // --- Setup Required stubs -------------------------------------------------------------
  // These report types are named in the O&M reporting spec but have no verified source-file
  // schema anywhere in this repository. Per the spec's own rule ("if an actual source-report
  // schema is unavailable, create a configurable report definition marked Setup Required
  // rather than inventing fields"), each stub below exists only so it's visible in the Import
  // Center and can be configured later - it accepts no file and maps to no dashboard today.
  {
    reportTypeId: "quote_approval_payment",
    displayName: "Quote Approval and Payment Report",
    purpose: "Setup Required - no verified column list exists yet for quote approval/payment tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "field_service_appointment",
    displayName: "Field Service Appointment Report",
    purpose: "Setup Required - no verified column list exists yet for field-service appointment tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "work_order",
    displayName: "Work Order Report",
    purpose: "Setup Required - no verified column list exists yet for work order tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "labor_travel_mileage",
    displayName: "Labor, Travel, and Mileage Report",
    purpose: "Setup Required - no verified column list exists yet for labor/travel/mileage tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "product_material_usage",
    displayName: "Product and Material Usage Report",
    purpose: "Setup Required - no verified column list exists yet for product/material usage tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "product_catalog_exception",
    displayName: "Product Catalog Exception Report",
    purpose: "Setup Required - no verified column list exists yet for product catalog exception tracking.",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  },
  {
    reportTypeId: "revenue",
    displayName: "Revenue Report",
    purpose: "Setup Required - no verified column list exists yet for a dedicated revenue report (quote value is already visible on the Quote Operations tab via EnQuote's own quote data).",
    sourceSystem: null,
    sourceLink: null,
    acceptedFileTypes: [".xlsx", ".csv"],
    expectedFileNames: [],
    expectedSheetNames: [],
    fieldGroups: [],
    dashboardsAffected: [],
    exampleMappings: [],
    schemaStatus: "setup_required",
    enabled: false
  }
];

/** Every field this report definition can fill in, taken straight from FIELD_DEFINITIONS. */
export function getFieldsForDefinition(definition) {
  if (!definition.fieldGroups.length) return [];
  return FIELD_DEFINITIONS.filter(field => definition.fieldGroups.includes(field.group));
}

/**
 * Scans the loaded daily-metric records for this report's source tag and reports when it was
 * last imported, how many days currently carry data from it, and the earliest/latest date
 * currently covered - never estimated, always derived directly from each record's own
 * `sources[reportTypeId]` provenance stamp and its own `date`.
 */
export function getImportStatsForSource(records, reportTypeId) {
  let lastImportedAt = null;
  let recordCount = 0;
  let totalRowsImported = 0;
  let earliestDate = null;
  let latestDate = null;
  (records || []).forEach(record => {
    const stamp = record?.sources?.[reportTypeId];
    if (!stamp) return;
    recordCount += 1;
    if (typeof stamp.row_count === "number") totalRowsImported += stamp.row_count;
    if (stamp.imported_at && (!lastImportedAt || stamp.imported_at > lastImportedAt)) {
      lastImportedAt = stamp.imported_at;
    }
    if (record.date) {
      if (!earliestDate || record.date < earliestDate) earliestDate = record.date;
      if (!latestDate || record.date > latestDate) latestDate = record.date;
    }
  });
  return { lastImportedAt, recordCount, totalRowsImported, earliestDate, latestDate };
}

// Neutralizes CSV formula injection (a cell beginning with =, +, -, @, or a tab/CR/LF) by
// prefixing it with a leading apostrophe - relevant here only as defense-in-depth, since every
// value this module writes into a template/sample file is a fixed label or number we control.
function sanitizeCsvCell(value) {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function rowsToCsv(rows) {
  return rows
    .map(row => row.map(cell => `"${sanitizeCsvCell(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

function downloadCsv(filename, rows) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Downloads a header-only CSV template listing Date + every field this report can fill in. */
export function downloadBlankTemplate(definition) {
  const fields = getFieldsForDefinition(definition);
  const header = ["Date", ...fields.map(f => f.label)];
  downloadCsv(`${definition.reportTypeId}_blank_template.csv`, [header]);
}

/**
 * Downloads a small, clearly-synthetic example file (two made-up rows) so a user can see the
 * expected shape without needing a real export on hand. Values are simple round numbers chosen
 * only to be plausible-looking placeholders - never derived from or resembling real data.
 */
export function downloadSyntheticSample(definition) {
  const fields = getFieldsForDefinition(definition);
  const header = ["Date", ...fields.map(f => f.label)];
  const sampleRow = (date, seed) => [date, ...fields.map((_, i) => (seed + i * 3) % 40 + 5)];
  const rows = [
    header,
    sampleRow("2026-01-05", 12),
    sampleRow("2026-01-06", 18)
  ];
  downloadCsv(`${definition.reportTypeId}_SYNTHETIC_SAMPLE.csv`, rows);
}
