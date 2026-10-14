import {hygieneFlagCategories} from "./quoteRequestHygiene.js";
import {caseLinkFor, enlightenSiteUrl} from "../../lib/externalLinks.js";

export const HYGIENE_EXPORT_COLUMNS = [
  {header: "Case #", key: "caseNumber", width: 13},
  {header: "Site ID", key: "siteId", width: 12},
  {header: "Comment Author", key: "author", width: 24},
  {header: "Comment Created", key: "created", width: 19},
  {header: "Current O&M Status", key: "omStatus", width: 24},
  {header: "Flags", key: "flagCount", width: 8},
  {header: "Flag Types", key: "flagTypes", width: 28, wrap: true},
  {header: "Review Findings", key: "findings", width: 64, wrap: true},
  {header: "Notes", key: "notes", width: 40, wrap: true},
  {header: "Source Comment (preview)", key: "commentPreview", width: 70}
];

const HEADER_ROW = 4;
const COLORS = {
  title: "FF1F2937", muted: "FF6B7280", headerFill: "FF1F3864", headerText: "FFFFFFFF",
  band: "FFF3F6FA", border: "FFD9DEE7", link: "FF0563C1",
  high: "FFFDE2E1", medium: "FFFFF2CC", none: "FFE2F0D9"
};
const PREVIEW_LENGTH = 220;
const LINE_HEIGHT = 15;
const MAX_ROW_HEIGHT = 150;
const thin = {style: "thin", color: {argb: COLORS.border}};
const BORDER = {top: thin, left: thin, bottom: thin, right: thin};
const fill = argb => ({type: "pattern", pattern: "solid", fgColor: {argb}});

/** Report dates arrive as text ("10/13/2026, 2:05 PM", ISO) or Excel serials. Returns a Date that Excel shows as the same wall-clock time, or null. */
export function parseCommentDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    return serial > 20000 && serial < 80000 ? new Date(Math.round((serial - 25569) * 86400000)) : null;
  }
  const parsed = new Date(text.replace(/,(?=\s*\d{1,2}:)/, ""));
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()));
}

function commentPreview(comment) {
  const text = String(comment || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(" · ");
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

function estimatedLines(text, width) {
  return String(text || "").split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(1, width - 2))), 0);
}

function rowHeight(values) {
  const lines = HYGIENE_EXPORT_COLUMNS.filter(column => column.wrap)
    .reduce((most, column) => Math.max(most, estimatedLines(values[column.key], column.width)), 1);
  return Math.min(MAX_ROW_HEIGHT, Math.max(18, lines * LINE_HEIGHT));
}

function linkValue(text, url, tooltip) {
  return url ? {text, hyperlink: url, tooltip} : text;
}

function flagFill(count) {
  if (!count) return COLORS.none;
  return count >= 3 ? COLORS.high : COLORS.medium;
}

export function describeExportFilters({author, search, flaggedOnly} = {}) {
  return [
    author ? `Comment author: ${author}` : "All comment authors",
    flaggedOnly ? "Flagged only" : "All request cases",
    search ? `Search: "${search}"` : ""
  ].filter(Boolean).join(" · ");
}

/**
 * Builds the Data Hygiene review workbook. `ExcelJS` is passed in so the (large) library is only
 * loaded when someone exports. `caseIndex` maps case numbers to Salesforce Case IDs for direct links.
 */
export function buildHygieneWorkbook(ExcelJS, records, {author = "", search = "", flaggedOnly = false, caseIndex, now = new Date()} = {}) {
  const rows = records || [];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EnQuote";
  workbook.created = now;
  const sheet = workbook.addWorksheet("Data Hygiene", {
    views: [{state: "frozen", xSplit: 0, ySplit: HEADER_ROW, showGridLines: false}],
    pageSetup: {orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0}
  });
  sheet.columns = HYGIENE_EXPORT_COLUMNS.map(({key, width}) => ({key, width}));
  const lastColumn = HYGIENE_EXPORT_COLUMNS.length;

  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).value = `Data Hygiene Review — ${author || "All comment authors"}`;
  sheet.getCell(1, 1).font = {bold: true, size: 16, color: {argb: COLORS.title}};
  sheet.getRow(1).height = 26;
  const flagged = rows.filter(record => record.flags.length).length;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = `${rows.length} request case${rows.length === 1 ? "" : "s"} · ${flagged} flagged · ${describeExportFilters({author, search, flaggedOnly})} · Exported ${now.toLocaleString()}`;
  sheet.getCell(2, 1).font = {italic: true, color: {argb: COLORS.muted}};

  const header = sheet.getRow(HEADER_ROW);
  HYGIENE_EXPORT_COLUMNS.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = {bold: true, color: {argb: COLORS.headerText}};
    cell.fill = fill(COLORS.headerFill);
    cell.alignment = {vertical: "middle", horizontal: column.key === "flagCount" ? "center" : "left", wrapText: true};
    cell.border = BORDER;
  });
  header.height = 22;

  rows.forEach((record, index) => {
    const caseLink = caseLinkFor(record.caseNumber, {index: caseIndex});
    const values = {
      caseNumber: linkValue(record.caseNumber || "", caseLink?.url, caseLink?.exact ? "Open case in Salesforce" : "Search Salesforce for this case"),
      siteId: linkValue(record.siteId || "", enlightenSiteUrl(record.siteId), "Open site in Enlighten"),
      author: record.author || "",
      created: parseCommentDate(record.created) || record.created || "",
      omStatus: record.omStatus || "",
      flagCount: record.flags.length,
      flagTypes: hygieneFlagCategories(record.flags).join("\n"),
      findings: record.flags.map(flag => `• ${flag}`).join("\n"),
      notes: (record.observations || []).map(note => `• ${note}`).join("\n"),
      commentPreview: commentPreview(record.comment)
    };
    const row = sheet.getRow(HEADER_ROW + 1 + index);
    HYGIENE_EXPORT_COLUMNS.forEach((column, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.value = values[column.key];
      cell.border = BORDER;
      cell.alignment = {vertical: "top", wrapText: Boolean(column.wrap), horizontal: column.key === "flagCount" ? "center" : "left"};
      if (index % 2) cell.fill = fill(COLORS.band);
    });
    for (const key of ["caseNumber", "siteId"]) {
      const cell = row.getCell(key);
      if (cell.value?.hyperlink) cell.font = {color: {argb: COLORS.link}, underline: true};
    }
    if (values.created instanceof Date) row.getCell("created").numFmt = "m/d/yyyy h:mm AM/PM";
    const countCell = row.getCell("flagCount");
    countCell.fill = fill(flagFill(record.flags.length));
    countCell.font = {bold: true};
    row.height = rowHeight(values);
  });
  sheet.autoFilter = {from: {row: HEADER_ROW, column: 1}, to: {row: HEADER_ROW + Math.max(rows.length, 1), column: lastColumn}};

  addSummarySheet(workbook, rows);
  addCommentsSheet(workbook, rows, caseIndex);
  return workbook;
}

function addSummarySheet(workbook, rows) {
  const sheet = workbook.addWorksheet("Summary", {views: [{showGridLines: false}]});
  sheet.columns = [{width: 42}, {width: 14}];
  const counts = new Map();
  for (const record of rows) for (const type of hygieneFlagCategories(record.flags)) counts.set(type, (counts.get(type) || 0) + 1);
  const table = [["Flag type", "Cases"], ...[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))];
  sheet.getCell("A1").value = "Most common flags";
  sheet.getCell("A1").font = {bold: true, size: 14, color: {argb: COLORS.title}};
  table.forEach((values, index) => {
    const row = sheet.getRow(3 + index);
    row.values = values;
    row.eachCell(cell => {
      cell.border = BORDER;
      if (!index) Object.assign(cell, {font: {bold: true, color: {argb: COLORS.headerText}}, fill: fill(COLORS.headerFill)});
      else if (index % 2 === 0) cell.fill = fill(COLORS.band);
    });
    row.getCell(2).alignment = {horizontal: "center"};
  });
  if (table.length === 1) sheet.getCell("A4").value = "No flags in this export.";
}

function addCommentsSheet(workbook, rows, caseIndex) {
  const sheet = workbook.addWorksheet("Source Comments", {views: [{state: "frozen", ySplit: 1, showGridLines: false}]});
  sheet.columns = [{header: "Case #", key: "caseNumber", width: 13}, {header: "Comment Author", key: "author", width: 24}, {header: "Source Comment", key: "comment", width: 110}];
  sheet.getRow(1).eachCell(cell => Object.assign(cell, {font: {bold: true, color: {argb: COLORS.headerText}}, fill: fill(COLORS.headerFill), border: BORDER}));
  rows.forEach((record, index) => {
    const caseLink = caseLinkFor(record.caseNumber, {index: caseIndex});
    const row = sheet.addRow({caseNumber: linkValue(record.caseNumber || "", caseLink?.url), author: record.author || "", comment: String(record.comment || "")});
    row.eachCell(cell => Object.assign(cell, {border: BORDER, alignment: {vertical: "top", wrapText: true}}));
    if (caseLink) row.getCell("caseNumber").font = {color: {argb: COLORS.link}, underline: true};
    if (index % 2) row.eachCell(cell => { cell.fill = fill(COLORS.band); });
    row.height = Math.min(409, Math.max(18, estimatedLines(record.comment, 110) * LINE_HEIGHT));
  });
}

export function hygieneWorkbookFileName(author, now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const who = String(author || "").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "all-authors";
  return `data-hygiene-${who}-${date}.xlsx`;
}
