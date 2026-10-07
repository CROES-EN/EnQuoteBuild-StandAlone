import test from "node:test";
import assert from "node:assert/strict";
import {buildCaseWorkReport, caseWorkDisplay, parseHistoryDate} from "../src/features/supervisorDashboard/caseWorkMetrics.js";
import {buildInvoicePaymentReport} from "../src/features/supervisorDashboard/invoicePaymentMetrics.js";
import {validateImport} from "../src/features/supervisorDashboard/importValidation.js";
import {AGGREGATION_MODES as MODES} from "../src/features/supervisorDashboard/periodAggregation.js";

const range = {start: "2026-07-01", end: "2026-07-02"};
const row = (field, oldValue, newValue, date = "7/1/2026 9:00 AM", caseNumber = "000123") => ({
  "Case Number": caseNumber, "Enlighten Site ID": "00123", "Case Owner": "Someone Else",
  "Field / Event": field, "Old Value": oldValue, "New Value": newValue,
  "Edited By": "Automation", "Edit Date": date
});

test("only team-outside transfers and historically team-owned closures qualify", () => {
  const transfer = row("Case Owner", "Alice", "Outside");
  const report = buildCaseWorkReport([
    transfer, {...transfer, Subject: "different snapshot"},
    row("Case Owner", "Outside", "Alice", "7/1/2026 10:00 AM"),
    row("Status", "New", "Closed", "7/1/2026 11:00 AM"),
    row("Status", "Closed", "New", "7/1/2026 12:00 PM"),
    row("Status", "New", "Closed", "7/2/2026 11:00 AM"),
    row("Subject", "", "Updated subject"),
    row("Solution Note", "", "Done"),
    row("Status", "New", "Assigned"),
    row("Case Owner", "Alice", "Bob", "7/2/2026 12:00 PM", "internal"),
    row("Status", "Closed", "Closed"),
    row("Created.", "", ""),
    row("Status", "New", "Closed", "7/1/2026 9:00 AM", "no-history")
  ], ["Alice", "Bob"]);
  assert.equal(report.transfers.length, 1);
  assert.equal(report.closures.length, 2, "outside editor and current owner do not exclude historically team-owned closure");
  assert.equal(report.duplicates, 1);
  assert.equal(report.unresolved.length, 1);
  assert.equal(caseWorkDisplay(report, "worked", range).value, 1);
  assert.equal(caseWorkDisplay(report, "closed", range).value, 1);
  assert.equal(caseWorkDisplay(report, "events", range).value, 3);
  assert.equal(caseWorkDisplay(report, "sites", range).value, 1);
  assert.equal(caseWorkDisplay(report, "unresolved", range).value, 1);
  assert.equal(caseWorkDisplay(report, "worked", range, MODES.DAILY_AVERAGE).value, 1);
  assert.equal(caseWorkDisplay(report, "events", range, MODES.DAILY_AVERAGE).value, 1.5);
  assert.equal(caseWorkDisplay(report, "events", range, MODES.LATEST_DAY).value, 1);
  assert.equal(caseWorkDisplay(report, "worked", {start: "2026-08-01", end: "2026-08-31"}).value, 0);
});

test("ambiguous owners never become confirmed closures; ownership anchors outside range are retained", () => {
  const report = buildCaseWorkReport([
    row("Case Owner", "Outside", "Alice", "6/30/2026 11:00 PM"),
    row("Status", "New", "Closed"),
    row("Case Owner", "Alice", "Outside", "7/2/2026 10:00 AM"),
    row("Status", "New", "Closed", "7/2/2026 10:00 AM"),
    row("Case Owner", "Outside", "Alice", "7/1/2026 8:00 AM", "conflict"),
    row("Case Owner", "Bob", "Outside", "7/2/2026 10:00 AM", "conflict"),
    row("Status", "New", "Closed", "7/1/2026 9:00 AM", "conflict"),
    row("Case Owner", "Outside", "Alice", "7/1/2026 8:00 AM", "same-minute"),
    row("Case Owner", "Alice", "Outside", "7/1/2026 8:00 AM", "same-minute"),
    row("Status", "New", "Closed", "7/1/2026 9:00 AM", "same-minute"),
    row("Status", "New", "Closed", "invalid", "invalid")
  ], ["Alice"]);
  assert.equal(report.closures.length, 1);
  assert.equal(report.unresolved.length, 3);
  assert.equal(report.invalid.length, 1);
  assert.equal(caseWorkDisplay(report, "events", range).value, 3, "simultaneous closure is unresolved, not a second work event");
  assert.throws(() => buildCaseWorkReport([], []), /team member/);
});

test("export dates preserve calendar date and reject impossible dates", () => {
  assert.equal(parseHistoryDate("9/30/2026 11:59 PM").date, "2026-09-30");
  for (const date of ["2/30/2026 9:00 AM", "9/30/2026 13:00 PM", "2026-01-01T24:00:00Z", "invalid"]) assert.equal(parseHistoryDate(date), null);
});

test("payments use actual amounts and paid dates, deduplicate invoices and exclude conflicts", () => {
  const payment = {"Invoice ID": "inv-1", "Paid Date": "7/1/2026", "Amount Paid": "1,250.25", Currency: "USD"};
  const report = buildInvoicePaymentReport([payment, payment, {...payment, "Invoice ID": "inv-2", "Amount Paid": "20.00"},
    {...payment, "Invoice ID": "conflict"}, {...payment, "Invoice ID": "conflict", "Amount Paid": "500"},
    {...payment, "Invoice ID": "bad", "Amount Paid": ""}, {...payment, "Invoice ID": "outside", "Paid Date": "8/1/2026"}], range);
  assert.equal(report.count, 2);
  assert.equal(report.amount, 1270.25);
  assert.equal(report.invalid.length, 2);
  assert.equal(buildInvoicePaymentReport([payment], range, MODES.DAILY_AVERAGE).amount, 625.125);
  assert.equal(buildInvoicePaymentReport([payment], range, MODES.LATEST_DAY).count, 0);
  assert.equal(buildInvoicePaymentReport([payment, {...payment, "Invoice ID": "euro", Currency: "EUR"}], range).amount, null);
  const invalidCopy = {...payment, "Amount Paid": ""};
  for (const rows of [[payment, invalidCopy], [invalidCopy, payment]]) {
    const ambiguous = buildInvoicePaymentReport(rows, range);
    assert.equal(ambiguous.count, 0, "an invalid duplicate cannot leave the invoice counted");
    assert.equal(ambiguous.amount, 0);
    assert.ok(ambiguous.invalid.length > 0);
  }
});

test("imports require the complete event/payment column contract", () => {
  assert.equal(validateImport("case_history", [{label: "Case Number"}, {label: "Status"}], [{}]).valid, false);
  assert.equal(validateImport("invoice_payments", [{label: "Invoice ID"}, {label: "Total"}], [{}]).valid, false);
});
