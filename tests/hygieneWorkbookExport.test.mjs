import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {buildHygieneWorkbook, hygieneWorkbookFileName, parseCommentDate} from "../src/features/autoDrafter/hygieneWorkbookExport.js";

const record = {
  caseNumber: "20443011", siteId: "684128", author: "Makorn Thamprateep", created: "10/5/2026, 2:05 PM", omStatus: "Quote Requested",
  flags: ["Missing or invalid quantity for Unistrut.", "Missing or unresolved Site ID in the request summary."],
  observations: ["Later note"], comment: "=HYPERLINK(\"http://x\")\nSecond line"
};

test("hygiene workbook keeps IDs as linked text, real dates and a readable layout", async () => {
  const caseIndex = new Map([["20443011", "500Ps00000AbCdEFGH"]]);
  const built = buildHygieneWorkbook(ExcelJS, [record, {...record, caseNumber: "0012", siteId: "N/A", flags: []}],
    {author: "Makorn Thamprateep", flaggedOnly: true, caseIndex, now: new Date(2026, 9, 13)});
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await built.xlsx.writeBuffer());
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Data Hygiene", "Summary", "Source Comments"]);
  const sheet = workbook.getWorksheet("Data Hygiene");
  assert.equal(sheet.getCell("A1").value, "Data Hygiene Review — Makorn Thamprateep");
  assert.match(sheet.getCell("A2").value, /^2 request cases · 1 flagged · Comment author: Makorn Thamprateep · Flagged only/);
  assert.equal(sheet.getCell("A4").value, "Case #");
  assert.equal(sheet.views[0].state, "frozen");
  assert.ok(sheet.autoFilter);
  const caseCell = sheet.getCell("A5").value;
  assert.equal(caseCell.text, "20443011");
  assert.equal(caseCell.hyperlink, "https://enphase.lightning.force.com/lightning/r/Case/500Ps00000AbCdEFGH/view");
  assert.equal(sheet.getCell("B5").value.hyperlink, "https://enlighten.enphaseenergy.com/admin/sites/684128");
  assert.equal(sheet.getCell("A6").value.text, "0012", "leading zeros survive; unknown case numbers link to Salesforce search");
  assert.match(sheet.getCell("A6").value.hyperlink, /^https:\/\/enphase\.lightning\.force\.com\/one\/one\.app#/);
  assert.equal(sheet.getCell("B6").value, "N/A");
  assert.ok(sheet.getCell("D5").value instanceof Date);
  assert.equal(sheet.getCell("D5").value.toISOString(), "2026-10-05T14:05:00.000Z");
  assert.equal(sheet.getCell("F5").value, 2);
  assert.match(sheet.getCell("H5").value, /^• Missing or invalid quantity for Unistrut\.\n• Missing/);
  assert.equal(sheet.getCell("J5").value, "=HYPERLINK(\"http://x\") · Second line", "comment preview is plain text on one line");
  assert.equal(sheet.getCell("J5").type, ExcelJS.ValueType.String);
  assert.ok(sheet.getRow(5).height <= 150);
  assert.equal(workbook.getWorksheet("Source Comments").getCell("C2").value, record.comment);
  assert.equal(workbook.getWorksheet("Summary").getCell("A3").value, "Flag type");
});

test("comment dates and file name", () => {
  assert.equal(parseCommentDate("46300").toISOString().slice(0, 10), "2026-10-05");
  assert.equal(parseCommentDate("not a date"), null);
  assert.equal(parseCommentDate(""), null);
  const now = new Date(2026, 9, 13);
  assert.equal(hygieneWorkbookFileName("Makorn Thamprateep", now), "data-hygiene-makorn-thamprateep-2026-10-13.xlsx");
  assert.equal(hygieneWorkbookFileName("", now), "data-hygiene-all-authors-2026-10-13.xlsx");
});
