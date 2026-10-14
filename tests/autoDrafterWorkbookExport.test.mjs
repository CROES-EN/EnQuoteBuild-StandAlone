import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {AUTO_DRAFTER_EXPORT_COLUMNS, autoDrafterExportFileName, buildAutoDrafterWorkbook} from "../src/features/autoDrafter/autoDrafterWorkbookExport.js";

const entries = [
  {
    caseNumber: "20443011", siteId: "0684128",
    comment: "Please quote 2 panels\nand an ATS",
    classification: {label: "Panel RMA + On-Demand", hasPanelRequest: true, reviewNotes: ["Check ATS"]},
    hygiene: {flags: ["Missing quantity.", "Missing Site ID."], observations: [], author: "Makorn Thamprateep", created: "10/9/2026, 2:05 PM", omStatus: "Quote Requested"},
    draftRecord: {sentToQuotes: true, realQuoteNumber: "Q-1001", generatedAt: new Date(2026, 9, 13, 14, 45).toISOString(),
      draft: {items: [{name: "Panel", quantity: 2, unit_price: 100, total: 200}]}},
    hasRealQuote: true, golden: true,
    careEligibility: {status: "ACTIVE_CARE"}, careError: false,
    panelRma: {current_status: "Submitted"}, skippedReason: ""
  },
  {caseNumber: "0012", siteId: "", comment: "", classification: {label: "Other"}, hygiene: {flags: [], observations: []}, draftRecord: null, golden: null}
];

test("auto-drafter workbook is a styled, filterable one-line-per-case table", async () => {
  const caseIndex = new Map([["20443011", "500Ps00000AbCdEFGH"]]);
  const built = buildAutoDrafterWorkbook(ExcelJS, entries, {caseIndex, now: new Date(2026, 9, 13)});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await built.xlsx.writeBuffer());
  const sheet = workbook.getWorksheet("Quote Requests");
  const col = header => AUTO_DRAFTER_EXPORT_COLUMNS.findIndex(column => column.header === header) + 1;

  assert.equal(sheet.getCell(1, 1).value, "Case Number", "header is row 1");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter, "header filters enabled");
  assert.equal(sheet.getCell(1, 1).fill.fgColor.argb, "FF0F4C5C", "teal header");

  assert.deepEqual(sheet.getCell(2, 1).value, {text: "20443011", hyperlink: "https://enphase.lightning.force.com/lightning/r/Case/500Ps00000AbCdEFGH/view"});
  assert.equal(sheet.getCell(2, 2).value.text, "0684128", "site ID keeps leading zero");
  assert.equal(sheet.getCell(3, 1).value.text, "0012");

  assert.equal(sheet.getCell(2, col("Line Items")).value, 1);
  assert.equal(sheet.getCell(2, col("Draft Total (USD)")).value, 200);
  assert.equal(sheet.getCell(2, col("Draft Total (USD)")).numFmt, "$#,##0.00");
  const generated = sheet.getCell(2, col("Draft Generated")).value;
  assert.ok(generated instanceof Date);
  assert.equal(generated.toISOString(), "2026-10-13T14:45:00.000Z", "shows local wall-clock time");
  assert.equal(sheet.getCell(2, col("Comment Created")).value.toISOString(), "2026-10-09T00:00:00.000Z");
  assert.equal(sheet.getCell(2, col("Request Comment")).value, "Please quote 2 panels | and an ATS");
  assert.equal(sheet.getCell(2, col("Hygiene Findings")).value, "Missing quantity. | Missing Site ID.");

  assert.equal(sheet.getCell(2, col("Draft Status")).fill.fgColor.argb, "FFDCF2E3", "sent = green chip");
  assert.equal(sheet.getCell(2, col("Golden Quote")).fill.fgColor.argb, "FFFBE7A1", "golden = gold chip");
  assert.equal(sheet.getCell(2, col("Hygiene Flags")).fill.fgColor.argb, "FFFDF0CC", "2 flags = amber chip");
  assert.equal(sheet.getCell(3, col("Hygiene Flags")).fill.fgColor.argb, "FFDCF2E3", "0 flags = green chip");
  assert.equal(sheet.getCell(3, col("Draft Status")).value, "Not drafted");

  sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.alignment?.wrapText, true, `${cell.address} must not wrap`)));
  assert.equal(sheet.getColumn(col("Case Number")).width, "Case Number".length + 5);
  assert.ok(sheet.getColumn(col("Request Comment")).width <= 80);
});

test("auto-drafter export file name uses the category and local date", () => {
  assert.equal(autoDrafterExportFileName("Panel RMA + On-Demand", new Date(2026, 9, 13)), "auto-drafter-panel-rma-on-demand-2026-10-13.xlsx");
  assert.equal(autoDrafterExportFileName(undefined, new Date(2026, 0, 2)), "auto-drafter-all-2026-01-02.xlsx");
});
