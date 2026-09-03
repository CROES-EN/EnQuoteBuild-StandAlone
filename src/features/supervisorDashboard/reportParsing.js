/**
 * Parsing/aggregation helpers for importing report exports (.xlsx/.xls/.csv/.html) into the
 * Supervisor Dashboard's daily metrics - CXONE/NICE (Contact Center + Workforce Management),
 * Salesforce, Incorta (O&M Scheduling / Case Backlog - including a raw "Export to HTML" dashboard
 * dump), Enphase Care/SVCancelTracker, and the escalations tracker all use this same generic
 * column-mapping mechanism.
 *
 * These reports vary export-to-export (column names, order, and whether they're
 * a per-agent/per-row breakdown or a single summary row), so instead of hard-coding one
 * exact layout, this module:
 *   1. Reads the workbook with all auto-coercion disabled (see readWorkbookRows)
 *      so every value comes through exactly as stored, with no SheetJS date/
 *      number guessing to second-guess.
 *   2. Guesses the header row and suggests a best-effort column mapping using
 *      fuzzy alias matching (see FIELD_DEFINITIONS/autoMapColumns).
 *   3. Lets the caller (ImportReportDialog) confirm/adjust that mapping, then
 *      aggregates the mapped rows into one record per calendar date.
 *
 * Every mapped numeric field (see SUMMABLE_NUMBER_FIELDS below) is aggregated by plain summation
 * across every row sharing the same date - never recomputed, derived, or fabricated. A field left
 * unmapped ("Not in this file") always comes out `null`, never a guessed/inferred value, so an
 * import can only ever report what was actually present in the uploaded file.
 */

// SheetJS's real ESM build (xlsx.mjs, what Vite/Rollup resolve for the browser bundle) only
// exposes named exports (read/utils/SSF/etc.) with no default export - verified against the
// installed node_modules/xlsx/xlsx.mjs. Named imports are required here for the build to work.
import { read, utils, SSF } from "xlsx";

export const FIELD_DEFINITIONS = [
  {
    key: "date",
    label: "Date",
    valueType: "date",
    required: false,
    group: "Row Identification",
    aliases: ["date", "report date", "call date", "interaction date", "activity date", "day", "date worked", "work date", "created date"]
  },
  {
    key: "agent",
    label: "Agent / Owner Name",
    valueType: "string",
    required: false,
    group: "Row Identification",
    aliases: ["agent", "agent name", "owner", "owner name", "full name", "user", "employee", "rep", "representative", "created by", "assigned to"]
  },
  {
    key: "calls",
    label: "Calls Handled",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["calls", "calls handled", "calls answered", "total calls", "call count", "handled calls", "number of calls", "inbound calls", "handled"]
  },
  {
    key: "calls_offered",
    label: "Calls Offered",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["calls offered", "offered calls", "total offered", "contacts offered", "offered"]
  },
  {
    key: "calls_abandoned",
    label: "Calls Abandoned",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["calls abandoned", "abandoned calls", "abandons", "abandoned", "total abandoned"]
  },
  {
    key: "aht",
    label: "Average Handle Time",
    valueType: "duration",
    required: false,
    group: "Contact Center",
    aliases: ["aht", "average handle time", "avg handle time", "handle time", "average handling time", "aht sec", "aht seconds", "average talk time", "avg aht", "avg talk time", "talk time"]
  },
  {
    key: "avg_wait_seconds",
    label: "Average Wait Time",
    valueType: "duration",
    required: false,
    group: "Contact Center",
    aliases: ["average wait time", "avg wait time", "asa", "average speed of answer", "wait time", "average queue time"]
  },
  {
    key: "emails_worked",
    label: "Emails Worked",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["emails worked", "emails handled", "email count", "emails", "cases worked", "cases closed", "tasks completed", "emails resolved", "email count worked"]
  },
  {
    key: "emails_received",
    label: "Emails Received",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["emails received", "email volume", "emails in queue", "total emails", "emails offered"]
  },
  {
    key: "quotes_drafted",
    label: "Quotes Drafted (legacy Overview field)",
    valueType: "number",
    required: false,
    group: "Contact Center",
    aliases: ["quotes drafted", "quotes created", "draft quotes", "new quotes", "quotes", "quote count", "drafted quotes", "record count"]
  },
  {
    key: "staffing_present",
    label: "Available Staff (present)",
    valueType: "number",
    required: false,
    group: "Staffing",
    // "agents scheduled"/"scheduled agents" intentionally moved to staffing_scheduled below - this
    // field is specifically the "present/available" headcount, not the scheduled one.
    aliases: ["staffing", "agents present", "headcount", "staff count", "present agents", "fte", "staffing count", "available staff", "staff available"]
  },
  {
    key: "staffing_scheduled",
    label: "Scheduled Staff",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["scheduled staff", "staff scheduled", "agents scheduled", "scheduled agents", "scheduled headcount", "scheduled fte"]
  },
  {
    key: "team_headcount",
    label: "Team Headcount",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["team headcount", "active employees", "total employees", "roster size", "team size", "assigned employees", "employees assigned"]
  },
  {
    key: "full_day_absences",
    label: "Full-Day Absences",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["full day absences", "full-day absences", "fulltime absences", "whole day absences", "absent full day", "fd absences"]
  },
  {
    key: "partial_day_absences",
    label: "Partial-Day Absences",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["partial day absences", "partial-day absences", "half day absences", "pd absences", "partial absences"]
  },
  {
    key: "training_capacity_loss",
    label: "Training/Meeting Capacity Loss",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["training capacity loss", "meeting capacity loss", "training loss", "meetings loss", "training and meetings", "capacity loss", "off phone time"]
  },
  {
    key: "scheduled_productive_hours",
    label: "Scheduled Productive Hours",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["scheduled productive hours", "scheduled hours", "productive hours scheduled", "planned productive hours"]
  },
  {
    key: "actual_productive_hours",
    label: "Actual Productive Hours",
    valueType: "number",
    required: false,
    group: "Staffing",
    aliases: ["actual productive hours", "actual hours", "productive hours actual", "worked productive hours"]
  },
  {
    key: "sf_quotes_received",
    label: "Salesforce Quotes Received",
    valueType: "number",
    required: false,
    group: "Quote Operations",
    aliases: ["quotes received", "quote requests", "quote request", "new quote requests", "requests received", "quote intake", "sf quotes received"]
  },
  {
    key: "case_backlog_start",
    label: "Case Backlog at Start",
    valueType: "number",
    required: false,
    group: "O&M Case Backlog",
    aliases: ["backlog at start", "backlog start", "starting backlog", "beginning backlog", "backlog sod", "open cases start"]
  },
  {
    key: "case_backlog_end",
    label: "Case Backlog at End",
    valueType: "number",
    required: false,
    group: "O&M Case Backlog",
    aliases: ["backlog at end", "backlog end", "ending backlog", "closing backlog", "backlog eod", "open cases end"]
  },
  {
    key: "new_cases_received",
    label: "New Cases Received",
    valueType: "number",
    required: false,
    group: "O&M Case Backlog",
    aliases: ["new cases received", "cases received", "new cases", "case intake", "cases opened", "new case count"]
  },
  {
    key: "cases_completed",
    label: "Cases Completed",
    valueType: "number",
    required: false,
    group: "O&M Case Backlog",
    aliases: ["cases completed", "completed cases", "cases closed", "case completions", "cases resolved"]
  },
  {
    key: "care_appt_cancellations",
    label: "Care Appointment Cancellations",
    valueType: "number",
    required: false,
    group: "Enphase Care",
    aliases: ["care appointment cancellations", "appointment cancellations", "canceled appointments", "cancelled appointments", "fst cancellations"]
  },
  {
    key: "care_plan_cancellation_requests",
    label: "Care Plan Cancellation Requests",
    valueType: "number",
    required: false,
    group: "Enphase Care",
    aliases: ["care plan cancellation requests", "plan cancellation requests", "care plan cancellations", "sv cancellations", "cancellation requests"]
  },
  {
    key: "care_cancellations_completed",
    label: "Care Cancellations Completed",
    valueType: "number",
    required: false,
    group: "Enphase Care",
    aliases: ["care cancellations completed", "cancellations completed", "completed cancellations", "cancellation completions"]
  },
  {
    key: "care_refunds_initiated",
    label: "Care Refunds Initiated",
    valueType: "number",
    required: false,
    group: "Enphase Care",
    aliases: ["care refunds initiated", "refunds initiated", "refunds issued", "refund requests"]
  },
  {
    key: "new_s1",
    label: "New S1 Escalations",
    valueType: "number",
    required: false,
    group: "Blockers & Escalations",
    aliases: ["new s1", "s1 escalations", "s1 count", "severity 1", "sev1", "sev 1 escalations"]
  },
  {
    key: "new_s2",
    label: "New S2 Escalations",
    valueType: "number",
    required: false,
    group: "Blockers & Escalations",
    aliases: ["new s2", "s2 escalations", "s2 count", "severity 2", "sev2", "sev 2 escalations"]
  },
  {
    key: "new_s3",
    label: "New S3 Escalations",
    valueType: "number",
    required: false,
    group: "Blockers & Escalations",
    aliases: ["new s3", "s3 escalations", "s3 count", "severity 3", "sev3", "sev 3 escalations"]
  },
  {
    key: "open_critical_escalations",
    label: "Open Critical Escalations",
    valueType: "number",
    required: false,
    group: "Blockers & Escalations",
    aliases: ["open critical escalations", "critical escalations open", "open critical", "critical open"]
  },
  {
    key: "overdue_follow_ups",
    label: "Overdue Follow-Ups",
    valueType: "number",
    required: false,
    group: "Blockers & Escalations",
    aliases: ["overdue follow ups", "overdue follow-ups", "overdue followups", "past due follow ups", "late follow ups"]
  }
];

// Every field above that's a plain additive sum across every row sharing the same date - no
// special per-row weighting, and no ambiguity between "column mapped but this row's value is 0"
// vs. "column not mapped at all" to resolve. Deliberately excludes:
//   - `staffing_present`: needs the "was a column actually mapped" distinction preserved (see its
//     dedicated handling in aggregateRowsByDate below - a prior version of this code inferred a
//     fallback value from unrelated per-agent-row data and silently overwrote a supervisor's
//     manually-entered "Available Staff" figure; that inference has been removed and must not
//     be reintroduced here).
//   - `aht`/`avg_wait_seconds`: durations, aggregated as a calls-weighted average, not a sum.
const SUMMABLE_NUMBER_FIELDS = [
  "calls", "calls_offered", "calls_abandoned", "emails_worked", "emails_received", "quotes_drafted",
  "staffing_scheduled", "team_headcount", "full_day_absences", "partial_day_absences",
  "training_capacity_loss", "scheduled_productive_hours", "actual_productive_hours",
  "sf_quotes_received",
  "case_backlog_start", "case_backlog_end", "new_cases_received", "cases_completed",
  "care_appt_cancellations", "care_plan_cancellation_requests", "care_cancellations_completed", "care_refunds_initiated",
  "new_s1", "new_s2", "new_s3", "open_critical_escalations", "overdue_follow_ups"
];

function normalizeHeaderText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Wraps a parsed SheetJS workbook with the same { sheetNames, getSheetRows } shape used by both
 * `readWorkbookRows` (browser File upload) and `readWorkbookFromBytes` (raw bytes, e.g. received
 * over Electron IPC from the O&M Reports Inbox auto-import watcher) - identical downstream
 * parsing/mapping/aggregation regardless of where the bytes originally came from.
 */
function wrapWorkbook(workbook) {
  const sheetNames = workbook.SheetNames || [];

  const getSheetRows = (sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  };

  return { sheetNames, getSheetRows };
}

/**
 * Reads an uploaded File (.xlsx/.xls/.csv) with all type coercion disabled, so
 * every cell comes back exactly as stored - no locale/timezone-dependent date
 * or number guessing baked in by SheetJS before our own parsers ever see it.
 */
export async function readWorkbookRows(file) {
  const buffer = await file.arrayBuffer();
  return wrapWorkbook(read(buffer, { type: "array", raw: true }));
}

/**
 * Same as `readWorkbookRows`, but for raw bytes already in memory (a Uint8Array) instead of a
 * browser File object - used by the O&M Reports Inbox auto-import watcher, which receives a
 * file's bytes over Electron IPC (main process reads the file from the watched folder) rather
 * than from a user-driven `<input type="file">` selection.
 */
export function readWorkbookFromBytes(bytes) {
  return wrapWorkbook(read(bytes, { type: "array", raw: true }));
}

const HTML_REPORT_EXTENSIONS = new Set([".html", ".htm"]);

export function isHtmlReportFile(filename) {
  const match = /\.[^.]+$/.exec(String(filename || ""));
  return match ? HTML_REPORT_EXTENSIONS.has(match[0].toLowerCase()) : false;
}

/**
 * Phase 1 of importing a file: cheaply lists the tab/section names available WITHOUT parsing
 * any row data yet, so the user can pick which one(s) actually matter before the app spends any
 * real time or memory on the rest. This matters most for the large multi-tab Incorta HTML
 * dashboard exports (hundreds of MB, ~10 named sections) and any multi-tab Excel workbook -
 * previously every tab's cells were fully parsed by SheetJS immediately on file selection even
 * though only one ever got used.
 *
 * Returns an opaque `peeked` object (its `_buffer`/`_text` fields are private/internal - pass
 * the whole object into `readPeekedSheets`, don't read them directly) so the already-loaded file
 * contents can be reused for the actual parse without reading the file from disk a second time.
 *
 * @param {File} file
 * @returns {Promise<{ kind: "html"|"spreadsheet", sheetNames: string[] }>}
 */
export async function peekReportFile(file) {
  if (isHtmlReportFile(file.name)) {
    const text = await file.text();
    return { kind: "html", sheetNames: peekHtmlSectionNames(text), _text: text };
  }
  const buffer = await file.arrayBuffer();
  // `bookSheets: true` stops SheetJS after reading just the sheet-name index - it does not
  // touch any sheet's actual cell data, so this stays fast even for a huge multi-tab workbook.
  const peek = read(buffer, { type: "array", bookSheets: true });
  return { kind: "spreadsheet", sheetNames: peek.SheetNames || [], _buffer: buffer };
}

/**
 * Phase 2: fully parses ONLY the requested tab(s)/section(s) from a file already inspected via
 * `peekReportFile` - every other tab/section is never parsed at all. When more than one is
 * selected, each is independently scanned for its own header row (so a repeated header row from
 * the 2nd/3rd tab is never mistaken for a data row) and only the FIRST selected one's header row
 * is kept as the canonical column layout - multi-select is only meaningful across tabs/sections
 * that share the same columns (e.g. a report broken into several same-shaped weekly tabs).
 *
 * @param {Awaited<ReturnType<typeof peekReportFile>>} peeked
 * @param {string[]} sheetNames
 * @returns {{ rows: Array<Array<any>>, headerRowIndex: number }}
 */
export function readPeekedSheets(peeked, sheetNames) {
  if (!sheetNames?.length) return { rows: [], headerRowIndex: 0 };

  if (peeked.kind === "html") {
    return mergeSheetRowSets(sheetNames.map(name => readHtmlSectionRows(peeked._text, name)));
  }

  // `sheets: [...]` limits SheetJS to fully parsing only the requested tabs - every other tab's
  // cells are never converted into memory, which is the whole point of the peek/read split.
  const workbook = read(peeked._buffer, { type: "array", raw: true, sheets: sheetNames });
  return mergeSheetRowSets(sheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    return sheet ? utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) : [];
  }));
}

/**
 * Fully parses exactly one requested tab/section from a file already inspected via
 * `peekReportFile`, returning its raw rows untouched (no header-row detection/stripping applied)
 * - unlike `readPeekedSheets`, this keeps the caller free to detect/override the header row
 * itself, matching this dialog's existing single-sheet behavior (an editable "Header row"
 * dropdown) for the common case of importing just one tab/section.
 *
 * @param {Awaited<ReturnType<typeof peekReportFile>>} peeked
 * @param {string} sheetName
 * @returns {Array<Array<any>>}
 */
export function readPeekedSheet(peeked, sheetName) {
  if (!sheetName) return [];
  if (peeked.kind === "html") {
    return readHtmlSectionRows(peeked._text, sheetName);
  }
  const workbook = read(peeked._buffer, { type: "array", raw: true, sheets: [sheetName] });
  const sheet = workbook.Sheets[sheetName];
  return sheet ? utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) : [];
}

/**
 * Combines one or more sheets'/sections' own rows (each with its own header row already at a
 * possibly-different index) into a single { rows, headerRowIndex: 0 } pair - the FIRST sheet's
 * header row is kept as the canonical column layout, and only the pure data rows (never a
 * repeated header row) from every sheet are concatenated beneath it, ready to hand straight to
 * the existing buildColumnOptions/autoMapColumns/aggregateRowsByDate pipeline unchanged.
 */
function mergeSheetRowSets(rowsPerSheet) {
  let headerRow = null;
  const dataRows = [];
  rowsPerSheet.forEach(rows => {
    if (!rows?.length) return;
    const headerIdx = guessHeaderRowIndex(rows);
    if (!headerRow) headerRow = rows[headerIdx] || [];
    rows.slice(headerIdx + 1).forEach(row => { if (!isBlankRow(row)) dataRows.push(row); });
  });
  return { rows: [headerRow || [], ...dataRows], headerRowIndex: 0 };
}

// ---------------------------------------------------------------------------------------------
// Incorta HTML dashboard export parsing ("Export to HTML" from a live Incorta dashboard)
//
// Confirmed against real EODB Dashboard and O&M Scheduling Dashboard exports: every named
// section/widget (matching the tab names visible in Incorta itself) is marked by a
// `<span>Title</span>` immediately before its content, and a section's real data grid is always
// a plain `<table><thead>...</thead><tbody>...</tbody></table>` - every other nested table in
// the export (borders, padding, icon wrappers, banner images) has no `<thead>` at all. This
// lets sections/grids be found reliably without hand-tuning anything about one specific
// dashboard's layout, and without needing to fully DOM-parse the (often hundreds-of-MB) document
// just to list its section names.
// ---------------------------------------------------------------------------------------------

const HTML_SECTION_TITLE_RE = /<span>([^<]*)<\/span>/g;

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ");
}

function findHtmlSectionMarkers(html) {
  const markers = [];
  HTML_SECTION_TITLE_RE.lastIndex = 0;
  let match;
  while ((match = HTML_SECTION_TITLE_RE.exec(html))) {
    const name = decodeHtmlEntities(match[1]).trim();
    if (name) markers.push({ name, index: match.index });
  }
  return markers;
}

/** Fast string scan for section titles - no DOM parsing, so this stays quick even for a huge file. */
export function peekHtmlSectionNames(html) {
  return findHtmlSectionMarkers(html).map(marker => marker.name);
}

/**
 * Extracts one named section's own bounded HTML slice (from its title marker to the next
 * section's title marker, or end of document) - keeps every downstream step's cost proportional
 * to one section's size, not the whole export.
 */
function extractHtmlSection(html, sectionName) {
  const markers = findHtmlSectionMarkers(html);
  const i = markers.findIndex(marker => marker.name === sectionName);
  if (i < 0) return "";
  const start = markers[i].index;
  const end = i + 1 < markers.length ? markers[i + 1].index : html.length;
  return html.slice(start, end);
}

/** Expands a header/data row's cells, repeating a cell's text across any `colspan` it declares. */
function cellsWithColspan(tr) {
  const out = [];
  Array.from(tr.cells).forEach(cell => {
    const span = Math.max(1, Number.parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
    const text = cell.textContent.replace(/\s+/g, " ").trim();
    for (let i = 0; i < span; i++) out.push(text);
  });
  return out;
}

/**
 * Parses one named section's data grid into the same rows[][] shape (header row included at
 * index 0) used everywhere else in this module, by finding the largest `<table>` within that
 * section that has a `<thead>` (real Incorta data grids always render this way). When a grid's
 * header spans more than one `<tr>` (a "pivot"-style table with a category row above a metric
 * row, e.g. "Enphase Care" above "# Cases"), every header row is joined column-by-column into
 * one compound label (e.g. "Enphase Care - # Cases") so each column stays distinguishable in the
 * mapping UI instead of several identical-looking "# Cases" options. Row-spanning header cells
 * are not specially handled (not needed for either real export inspected while building this).
 */
export function readHtmlSectionRows(html, sectionName) {
  const slice = extractHtmlSection(html, sectionName);
  if (!slice) return [];

  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${slice}</body></html>`, "text/html");
  const candidates = Array.from(doc.querySelectorAll("table")).filter(table => table.tHead && table.tHead.rows.length);
  if (!candidates.length) return [];

  // The real data grid is the largest qualifying table by row count - decorative/legend tables
  // that happen to also use <thead> are always tiny by comparison.
  const table = candidates.reduce((best, t) => (t.rows.length > best.rows.length ? t : best));

  const headerRows = Array.from(table.tHead.rows).map(cellsWithColspan);
  const columnCount = Math.max(0, ...headerRows.map(r => r.length));
  const compoundHeader = Array.from({ length: columnCount }, (_, col) =>
    headerRows.map(r => r[col]).filter(Boolean).join(" - ")
  );

  const bodyRows = Array.from(table.tBodies).flatMap(tbody => Array.from(tbody.rows).map(cellsWithColspan));

  return [compoundHeader, ...bodyRows];
}

function isBlankRow(row) {
  return !row || row.every(cell => String(cell ?? "").trim() === "");
}

function looksNumeric(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^-?[\d,]+(\.\d+)?%?$/.test(text);
}

/**
 * Guesses which row holds column headers by scanning the first several rows
 * for the first non-blank row that is mostly non-numeric text and is directly
 * followed by a row containing at least one numeric-looking cell (real data
 * exports commonly have a title/date-range row or two above the real header).
 */
export function guessHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;

    const nonBlankCells = row.filter(cell => String(cell ?? "").trim() !== "");
    const textCells = nonBlankCells.filter(cell => !looksNumeric(cell));
    const mostlyText = nonBlankCells.length > 0 && textCells.length / nonBlankCells.length >= 0.6;

    const nextRow = rows[i + 1];
    const nextHasData = nextRow && !isBlankRow(nextRow);

    if (mostlyText && nextHasData && nonBlankCells.length >= 2) {
      return i;
    }
  }
  return 0;
}

export function buildColumnOptions(rows, headerRowIndex) {
  const headerRow = rows[headerRowIndex] || [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), headerRow.length);

  return Array.from({ length: columnCount }, (_, index) => {
    const headerText = String(headerRow[index] ?? "").trim();
    return {
      index,
      header: headerText,
      label: headerText || `Column ${index + 1} (blank header)`
    };
  });
}

/**
 * Suggests a best-effort { fieldKey: columnIndex } mapping using fuzzy alias
 * matching against normalized column headers. Exact alias matches win outright;
 * otherwise the longest overlapping alias wins to reduce false-positive
 * substring matches (e.g. a generic "Time" alias shouldn't out-score "Handle Time").
 * Each column is only ever assigned to a single field, and fields with no
 * confident match are left null for the user to map manually.
 *
 * @param {Array} columnOptions
 * @param {Array} fieldDefinitions - defaults to every known field; callers that let a user hide
 *   fields they never use for a given report (see columnPreferences.js) pass a filtered list so
 *   auto-mapping never assigns a column to a field the user has chosen not to import.
 */
export function autoMapColumns(columnOptions, fieldDefinitions = FIELD_DEFINITIONS) {
  const scored = [];

  columnOptions.forEach(column => {
    const normalized = normalizeHeaderText(column.header);
    if (!normalized) return;

    fieldDefinitions.forEach(field => {
      field.aliases.forEach(alias => {
        if (normalized === alias) {
          scored.push({ fieldKey: field.key, columnIndex: column.index, score: 1000 + alias.length });
        } else if (normalized.includes(alias)) {
          scored.push({ fieldKey: field.key, columnIndex: column.index, score: alias.length });
        }
      });
    });
  });

  scored.sort((a, b) => b.score - a.score);

  const mapping = Object.fromEntries(fieldDefinitions.map(field => [field.key, null]));
  const usedColumns = new Set();

  scored.forEach(({ fieldKey, columnIndex }) => {
    if (mapping[fieldKey] !== null || usedColumns.has(columnIndex)) return;
    mapping[fieldKey] = columnIndex;
    usedColumns.add(columnIndex);
  });

  return mapping;
}


function parseNumberCell(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,$%\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses an AHT/duration cell into whole seconds. Handles the formats seen in
 * real CXONE/Excel exports:
 *   - "h:mm:ss" / "m:ss" text (most common CXONE display format)
 *   - a plain number < 1, treated as an Excel time-of-day fraction (a raw
 *     serial for a cell formatted as a clock time - pure arithmetic, no
 *     timezone involved since it's a fraction of a day, not a calendar date)
 *   - a plain number >= 1, treated as whole seconds
 */
export function parseDurationToSeconds(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    const hms = trimmed.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/);
    if (hms) {
      const [, h, m, s] = hms;
      return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
    const ms = trimmed.match(/^(\d{1,3}):([0-5]?\d)$/);
    if (ms) {
      const [, m, s] = ms;
      return Number(m) * 60 + Number(s);
    }
    const numeric = parseNumberCell(trimmed);
    if (numeric === null) return null;
    return numeric > 0 && numeric < 1 ? Math.round(numeric * 86400) : Math.round(numeric);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 0 && value < 1 ? Math.round(value * 86400) : Math.round(value);
  }

  return null;
}

// Some real exports (confirmed against an actual Incorta EODB Dashboard export - columns like
// "Avg. Wait Time(mins)"/"Avg. Talk time (mins)") report a duration as a plain decimal number of
// MINUTES rather than seconds or a clock string - parseDurationToSeconds alone would silently
// treat "3.2" as 3 seconds instead of 3.2 minutes. Detecting "(mins)"/"minutes" in the mapped
// column's own header text (never guessed from the value itself) lets aggregateRowsByDate apply
// a deterministic x60 correction only when the source column explicitly says its unit is minutes.
export function isMinutesColumnHeader(headerText) {
  const text = String(headerText ?? "").toLowerCase();
  return /\bmin(ute)?s?\b/.test(text) && !/\bsec/.test(text);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Parses a date cell into a "YYYY-MM-DD" string with no timezone drift.
 *   - Numbers are decoded via SheetJS's SSF.parse_date_code, which is pure
 *     day-count arithmetic on the Excel serial - no Date object, no timezone.
 *   - Strings are matched against explicit known formats and built directly
 *     from the captured digits (never passed through `new Date(str)`, which
 *     for ISO strings parses as UTC and can silently roll the date backward
 *     or forward a day once converted through a local-timezone serial).
 *   - A Date instance (defensive fallback only) uses LOCAL getters, since any
 *     Date object we might encounter would have been constructed from local-
 *     time semantics symmetrically.
 */
export function parseDateCell(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const decoded = SSF.parse_date_code(value);
    if (!decoded) return null;
    return `${decoded.y}-${pad2(decoded.m)}-${pad2(decoded.d)}`;
  }

  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      const [, y, m, d] = iso;
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const [, m, d, y] = slash;
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    const slashShortYear = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (slashShortYear) {
      const [, m, d, y] = slashShortYear;
      return `20${y}-${pad2(m)}-${pad2(d)}`;
    }

    const dashUs = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashUs) {
      const [, m, d, y] = dashUs;
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    // Last-resort fallback for less common textual formats (e.g. "Aug 31, 2026").
    // Uses LOCAL getters so it round-trips consistently within this same process.
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
    }
  }

  return null;
}

/**
 * Aggregates mapped report rows into one metrics record per calendar date.
 *
 * @param {Array<Array<any>>} rows - full sheet rows (array of arrays), including the header row.
 * @param {number} headerRowIndex - index of the header row within `rows`.
 * @param {Object} mapping - { [FIELD_DEFINITIONS key]: column index or null }. Every key in
 *   SUMMABLE_NUMBER_FIELDS is summed across rows sharing a date; `aht`/`avg_wait_seconds` are a
 *   calls-weighted average; `staffing_present` is summed but only ever set when explicitly
 *   mapped (see the dedicated note below). Any key left unmapped always comes out `null`.
 * @param {string|null} fallbackDate - "YYYY-MM-DD" applied to every row when no date column is mapped (single-day import).
 * @param {"cxone"|"salesforce"|"nice_wfm"|"incorta"|"care_tracker"|"escalations_tracker"|"other"} source -
 *   which report this import came from, recorded for traceability.
 */
export function aggregateRowsByDate({ rows, headerRowIndex, mapping, fallbackDate = null, source = "other" }) {
  const dataRows = rows.slice(headerRowIndex + 1).filter(row => !isBlankRow(row));
  const byDate = new Map();
  const warnings = [];
  let skipped = 0;

  // Read straight from this file's own header text (never guessed from the values) so a column
  // explicitly labeled e.g. "Avg. Wait Time(mins)" is converted from minutes to seconds instead
  // of being silently misread as raw seconds - see isMinutesColumnHeader.
  const headerRow = rows[headerRowIndex] || [];
  const ahtIsMinutes = mapping.aht !== null && mapping.aht !== undefined && isMinutesColumnHeader(headerRow[mapping.aht]);
  const waitIsMinutes = mapping.avg_wait_seconds !== null && mapping.avg_wait_seconds !== undefined && isMinutesColumnHeader(headerRow[mapping.avg_wait_seconds]);

  dataRows.forEach((row, rowOffset) => {
    const rowNumber = headerRowIndex + 2 + rowOffset;
    const rawDate = mapping.date !== null && mapping.date !== undefined ? row[mapping.date] : null;
    const date = mapping.date !== null && mapping.date !== undefined ? parseDateCell(rawDate) : fallbackDate;

    if (!date) {
      skipped += 1;
      if (warnings.length < 20) {
        warnings.push(`Row ${rowNumber}: could not determine a date${rawDate ? ` (saw "${rawDate}")` : ""} - row skipped.`);
      }
      return;
    }

    const agentName = mapping.agent !== null && mapping.agent !== undefined ? String(row[mapping.agent] ?? "").trim() : "";

    const rowValues = {};
    SUMMABLE_NUMBER_FIELDS.forEach(key => {
      rowValues[key] = mapping[key] !== null && mapping[key] !== undefined ? parseNumberCell(row[mapping[key]]) : null;
    });
    const calls = rowValues.calls; // also used below to weight aht/avg-wait and for per-agent tracking
    const ahtSecondsRaw = mapping.aht !== null && mapping.aht !== undefined ? parseDurationToSeconds(row[mapping.aht]) : null;
    const ahtSeconds = ahtSecondsRaw !== null && ahtIsMinutes ? ahtSecondsRaw * 60 : ahtSecondsRaw;
    const avgWaitSecondsRaw = mapping.avg_wait_seconds !== null && mapping.avg_wait_seconds !== undefined ? parseDurationToSeconds(row[mapping.avg_wait_seconds]) : null;
    const avgWaitSeconds = avgWaitSecondsRaw !== null && waitIsMinutes ? avgWaitSecondsRaw * 60 : avgWaitSecondsRaw;
    const staffing = mapping.staffing_present !== null && mapping.staffing_present !== undefined ? parseNumberCell(row[mapping.staffing_present]) : null;

    if (!byDate.has(date)) {
      const bucket = {
        date,
        ahtWeightedSum: 0,
        ahtWeight: 0,
        waitWeightedSum: 0,
        waitWeight: 0,
        staffing_present: 0,
        hasStaffingColumn: false,
        agentNames: new Set(),
        agents: new Map(),
        rowCount: 0
      };
      SUMMABLE_NUMBER_FIELDS.forEach(key => { bucket[key] = 0; });
      byDate.set(date, bucket);
    }

    const bucket = byDate.get(date);
    bucket.rowCount += 1;
    SUMMABLE_NUMBER_FIELDS.forEach(key => {
      if (rowValues[key] !== null) bucket[key] += rowValues[key];
    });
    if (staffing !== null) {
      bucket.staffing_present += staffing;
      bucket.hasStaffingColumn = true;
    }
    if (ahtSeconds !== null) {
      const weight = calls && calls > 0 ? calls : 1;
      bucket.ahtWeightedSum += ahtSeconds * weight;
      bucket.ahtWeight += weight;
    }
    if (avgWaitSeconds !== null) {
      const weight = calls && calls > 0 ? calls : 1;
      bucket.waitWeightedSum += avgWaitSeconds * weight;
      bucket.waitWeight += weight;
    }
    if (agentName) bucket.agentNames.add(agentName);

    // Per-agent breakdown is only tracked for the original Contact Center fields (this predates
    // - and is unrelated to - the newer team/queue-level tabs, which have no per-agent dimension).
    if (agentName) {
      const existingAgent = bucket.agents.get(agentName) || { name: agentName };
      if (calls !== null) existingAgent.calls = (existingAgent.calls || 0) + calls;
      if (rowValues.calls_offered !== null) existingAgent.calls_offered = (existingAgent.calls_offered || 0) + rowValues.calls_offered;
      if (rowValues.calls_abandoned !== null) existingAgent.calls_abandoned = (existingAgent.calls_abandoned || 0) + rowValues.calls_abandoned;
      if (ahtSeconds !== null) existingAgent.aht_seconds = ahtSeconds;
      if (avgWaitSeconds !== null) existingAgent.avg_wait_seconds = avgWaitSeconds;
      if (rowValues.emails_worked !== null) existingAgent.emails_worked = (existingAgent.emails_worked || 0) + rowValues.emails_worked;
      if (rowValues.emails_received !== null) existingAgent.emails_received = (existingAgent.emails_received || 0) + rowValues.emails_received;
      if (rowValues.quotes_drafted !== null) existingAgent.quotes_drafted = (existingAgent.quotes_drafted || 0) + rowValues.quotes_drafted;
      if (staffing !== null) existingAgent.staffing_present = (existingAgent.staffing_present || 0) + staffing;
      bucket.agents.set(agentName, existingAgent);
    }
  });

  const importedAt = new Date().toISOString();
  const records = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(bucket => {
      const record = {
        date: bucket.date,
        aht_seconds: bucket.ahtWeight > 0 ? Math.round(bucket.ahtWeightedSum / bucket.ahtWeight) : null,
        avg_wait_seconds: bucket.waitWeight > 0 ? Math.round(bucket.waitWeightedSum / bucket.waitWeight) : null,
        // Only set from an explicitly-mapped staffing column - never inferred from the count of
        // distinct agent names seen in the file. The dedicated Staffing tab treats this same
        // `staffing_present` field ("Available Staff") as manual-entry-eligible; guessing a value
        // from agent-name-count here would silently clobber whatever a supervisor typed there.
        staffing_present: bucket.hasStaffingColumn ? bucket.staffing_present : null,
        agents: Array.from(bucket.agents.values()),
        sources: { [source]: { imported_at: importedAt, row_count: bucket.rowCount } }
      };
      SUMMABLE_NUMBER_FIELDS.forEach(key => {
        record[key] = (mapping[key] !== null && mapping[key] !== undefined) ? bucket[key] : null;
      });
      return record;
    });

  return {
    records,
    warnings,
    totalRowsProcessed: dataRows.length - skipped,
    totalRowsSkipped: skipped
  };
}
