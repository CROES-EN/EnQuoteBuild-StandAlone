// Builds the Auto-Drafter "Quote Requests" Excel export from the same per-case data the tiles
// show. The page gathers each case's classification, hygiene, draft, Care and RMA details.
// A styled, filterable table: one line per case, fitted widths, frozen header, status chips.
import {calculateQuoteTotals} from "../../utils/quoteCalculations.js";
import {caseLinkFor, enlightenSiteUrl} from "../../lib/externalLinks.js";
import {parseCommentDate} from "./hygieneWorkbookExport.js";

const CARE_LABELS = {ACTIVE_CARE: "Active Care", NO_ACTIVE_CARE: "No active Care", NOT_FOUND: "Not found"};
const DATE_FORMAT = "m/d/yyyy";
const DATE_TIME_FORMAT = "m/d/yyyy h:mm";
const MONEY_FORMAT = "$#,##0.00";
// Teal palette so this export reads as a sibling of the navy Data Hygiene workbook, not a copy.
const COLORS = {
  headerFill: "FF0F4C5C", headerText: "FFFFFFFF", headerBorder: "FF0B3945",
  band: "FFF1F7F8", border: "FFD6E4E7", text: "FF1F2937", muted: "FF6B7280", link: "FF0E7490",
  good: "FFDCF2E3", goodText: "FF14532D", warn: "FFFDF0CC", warnText: "FF7A4B00",
  bad: "FFFBE1DF", badText: "FF8A1C1C", neutral: "FFECEFF3", gold: "FFFBE7A1", goldText: "FF6B4E00"
};
const fill = argb => ({type: "pattern", pattern: "solid", fgColor: {argb}});
const line = argb => ({style: "thin", color: {argb}});
const BORDER = {top: line(COLORS.border), left: line(COLORS.border), bottom: line(COLORS.border), right: line(COLORS.border)};
const HEADER_BORDER = {top: line(COLORS.headerBorder), left: line(COLORS.headerBorder), bottom: line(COLORS.headerBorder), right: line(COLORS.headerBorder)};
const CHIPS = {
  good: {fill: COLORS.good, text: COLORS.goodText}, warn: {fill: COLORS.warn, text: COLORS.warnText},
  bad: {fill: COLORS.bad, text: COLORS.badText}, neutral: {fill: COLORS.neutral, text: COLORS.muted},
  gold: {fill: COLORS.gold, text: COLORS.goldText}
};
const DRAFT_TONES = {"Sent to Quotes": "good", "Draft ready": "warn", "Not drafted": "neutral"};
const CARE_TONES = {"Active Care": "good", "No active Care": "bad", "Not found": "neutral", Unverified: "warn"};

// Multi-line text (comments, findings) is joined onto one line so rows stay one line tall.
function singleLine(value) {
  return String(value ?? "").split(/\r\n|\r|\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
}

const yesNo = value => (value ? "Yes" : "No");

function draftTotal(record) {
  if (!record?.draft) return null;
  const total = calculateQuoteTotals(record.draft).total;
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null;
}

// Excel stores dates without a zone; shift so the cell shows the local wall-clock time.
function localDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()));
}

function commentDate(value) {
  const date = parseCommentDate(value);
  if (!date) return singleLine(value) || null;
  // Comment dates rarely carry a meaningful time in the report; show the date like Salesforce does.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Column order and value readers. `maxWidth` caps fitted widths for long text. */
export const AUTO_DRAFTER_EXPORT_COLUMNS = [
  {header: "Case Number", read: entry => entry.caseNumber || ""},
  {header: "Site ID", read: entry => entry.siteId || ""},
  {header: "O&M Status", read: entry => entry.hygiene?.omStatus || ""},
  {header: "Comment Created", read: entry => commentDate(entry.hygiene?.created), numFmt: DATE_FORMAT},
  {header: "Requested By", read: entry => entry.hygiene?.author || ""},
  {header: "Case Category", read: entry => entry.classification?.label || ""},
  {header: "Panel Request", read: entry => yesNo(entry.classification?.hasPanelRequest), align: "center"},
  {header: "Draft Status", read: entry => (!entry.draftRecord ? "Not drafted" : entry.draftRecord.sentToQuotes ? "Sent to Quotes" : "Draft ready"), tone: value => DRAFT_TONES[value]},
  {header: "Quote Number", read: entry => (entry.draftRecord?.sentToQuotes ? entry.draftRecord.realQuoteNumber : entry.draftRecord?.quoteNumber) || ""},
  {header: "Line Items", read: entry => (entry.draftRecord?.draft ? (entry.draftRecord.draft.items || []).length : null), align: "center"},
  {header: "Draft Total (USD)", read: entry => draftTotal(entry.draftRecord), numFmt: MONEY_FORMAT, align: "right"},
  {header: "Draft Generated", read: entry => localDate(entry.draftRecord?.generatedAt), numFmt: DATE_TIME_FORMAT},
  {header: "Quote Already in EnQuote", read: entry => yesNo(entry.hasRealQuote), align: "center"},
  {header: "Golden Quote", read: entry => (entry.golden === undefined || entry.golden === null ? "" : yesNo(entry.golden)), align: "center", tone: value => (value === "Yes" ? "gold" : null)},
  {header: "Care Status", read: entry => (entry.careError ? "Unverified" : CARE_LABELS[entry.careEligibility?.status] || ""), tone: value => CARE_TONES[value]},
  {header: "Panel RMA Status", read: entry => entry.panelRma?.current_status || ""},
  {header: "Hygiene Flags", read: entry => (entry.hygiene ? entry.hygiene.flags.length : null), align: "center",
    tone: value => (typeof value !== "number" ? null : value === 0 ? "good" : value <= 2 ? "warn" : "bad")},
  {header: "Hygiene Findings", read: entry => (entry.hygiene?.flags || []).join(" | "), maxWidth: 60},
  {header: "Review Notes", read: entry => [...(entry.classification?.reviewNotes || []), ...(entry.hygiene?.observations || [])].join(" | "), maxWidth: 60},
  {header: "Auto-Draft Skipped Reason", read: entry => entry.skippedReason || "", maxWidth: 50},
  {header: "Request Comment", read: entry => entry.comment || "", maxWidth: 80}
];

function displayLength(value, numFmt) {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return numFmt === DATE_TIME_FORMAT ? 16 : 10;
  if (typeof value === "number") return numFmt === MONEY_FORMAT ? value.toFixed(2).length + Math.floor(Math.log10(Math.max(1, Math.abs(value))) / 3) + 1 : String(value).length;
  return String(value).length;
}

/**
 * @param {any} ExcelJS The exceljs module, loaded lazily by the caller.
 * @param {object[]} entries Per-case export entries (see AutoDrafter.jsx exportWorkbook).
 * @param {{caseIndex?: any, now?: Date}} [options]
 */
export function buildAutoDrafterWorkbook(ExcelJS, entries, {caseIndex, now = new Date()} = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EnQuote";
  workbook.created = now;
  const sheet = workbook.addWorksheet("Quote Requests", {
    views: [{state: "frozen", ySplit: 1, showGridLines: false}],
    properties: {tabColor: {argb: COLORS.headerFill}, defaultRowHeight: 18}
  });
  const columns = AUTO_DRAFTER_EXPORT_COLUMNS;
  const rows = (entries || []).map(entry => columns.map(column => {
    const value = column.read(entry);
    return typeof value === "string" ? singleLine(value) : value;
  }));

  const header = sheet.getRow(1);
  columns.forEach((column, index) => {
    Object.assign(header.getCell(index + 1), {
      value: column.header,
      font: {bold: true, color: {argb: COLORS.headerText}},
      fill: fill(COLORS.headerFill),
      border: HEADER_BORDER,
      alignment: {vertical: "middle", horizontal: column.align || "left", wrapText: false}
    });
  });
  header.height = 24;

  rows.forEach((values, rowIndex) => {
    const row = sheet.getRow(rowIndex + 2);
    const entry = entries[rowIndex];
    row.height = 18;
    values.forEach((value, index) => {
      const column = columns[index];
      const cell = row.getCell(index + 1);
      cell.value = value === "" ? null : value;
      if (column.numFmt && value !== null && typeof value !== "string") cell.numFmt = column.numFmt;
      cell.border = BORDER;
      cell.alignment = {vertical: "middle", horizontal: column.align || "left", wrapText: false};
      cell.font = {color: {argb: COLORS.text}};
      if (rowIndex % 2) cell.fill = fill(COLORS.band);
      const chip = CHIPS[column.tone?.(value)];
      if (chip) Object.assign(cell, {fill: fill(chip.fill), font: {bold: true, color: {argb: chip.text}}});
    });
    // IDs stay text (leading zeros, no scientific notation) and open Salesforce / Enlighten.
    const caseLink = entry.caseNumber ? caseLinkFor(entry.caseNumber, {index: caseIndex}) : null;
    const siteUrl = entry.siteId ? enlightenSiteUrl(entry.siteId) : null;
    const linkFont = {color: {argb: COLORS.link}, underline: true};
    if (caseLink?.url) Object.assign(row.getCell(1), {value: {text: values[0], hyperlink: caseLink.url}, font: {...linkFont, bold: true}});
    if (siteUrl) Object.assign(row.getCell(2), {value: {text: values[1], hyperlink: siteUrl}, font: linkFont});
  });

  columns.forEach((column, index) => {
    // Header gets room for the filter drop-down arrow.
    const longest = rows.reduce((most, values) => Math.max(most, displayLength(values[index], column.numFmt)), column.header.length + 3);
    sheet.getColumn(index + 1).width = Math.min(column.maxWidth || 40, Math.max(8, longest + 2));
  });
  sheet.autoFilter = {from: {row: 1, column: 1}, to: {row: Math.max(rows.length, 1) + 1, column: columns.length}};
  return workbook;
}

export function autoDrafterExportFileName(categoryLabel, now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const slug = String(categoryLabel || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all";
  return `auto-drafter-${slug}-${date}.xlsx`;
}
