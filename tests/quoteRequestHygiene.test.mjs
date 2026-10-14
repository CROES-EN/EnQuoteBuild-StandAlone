import test from "node:test";
import assert from "node:assert/strict";
import {assessQuoteRequestHygiene, buildQuoteRequestHygieneReport, quoteRequestReportColumns, HYGIENE_VERIFICATION_NOTE} from "../src/features/autoDrafter/quoteRequestHygiene.js";

const headers = ["Case Number", "Enlighten Site ID", "Case Comments", "Case Comment Created By", "Case Comment Created Date", "O&M Status", "Case Owner"];
const columns = quoteRequestReportColumns(headers);
const complete = `O&M_QUOTE_REQUEST
Quote Category: Other
RMA Required: Unknown
Site Information
Site ID: 100
Case Number: 001
Customer Name: Test Customer
Site Address: Test address
Findings
Problem Description: Solar panel damage
Recommended Scope of Work
Scope Description: Panel RMA
Site Characteristics
Access Requirements
Labor
Travel
Products
Item Name: Solar panel
Quantity: 1
Services
Service Name: None
Additional Materials
Item Name: None
Technician Recommendations`;
const row = (overrides = {}) => ({"Case Number": "001", "Enlighten Site ID": "100", "Case Comments": complete,
  "Case Comment Created By": "Request Author", "Case Comment Created Date": "2026-10-13T12:00:00Z",
  "O&M Status": "Quote Requested", "Case Owner": "Not The Requester", ...overrides});

test("complete observable summary has no flags but photos, usage and accuracy remain unverified", () => {
  const result = assessQuoteRequestHygiene(row(), columns);
  assert.deepEqual(result.flags, []);
  assert.equal(result.author, "Request Author");
  assert.equal(result.verification, HYGIENE_VERIFICATION_NOTE);
  assert.match(result.verification, /photos.*agent usage.*factual accuracy/);
  assert.deepEqual(assessQuoteRequestHygiene(row({"Case Comments": complete.split("\n").map(line => `- ${line}`).join("\n")}), columns).flags, []);
  assert.deepEqual(assessQuoteRequestHygiene(row({"Case Comments": complete.replace("Quantity: 1", "Quantity: 1-2")}), columns).flags, []);
});

test("missing template, fields, mismatched IDs, quantities and status have specific findings", () => {
  const result = assessQuoteRequestHygiene(row({"Case Comments": complete.replace("O&M_QUOTE_REQUEST", "Please quote")
    .replace("Customer Name: Test Customer", "Customer Name: Unknown")
    .replace("Scope Description: Panel RMA", "")
    .replace("Site ID: 100", "Site ID: 999")
    .replace("Quantity: 1", "Quantity: -2"), "O&M Status": ""}), columns);
  for (const pattern of [/header is missing/, /Customer Name/, /Scope Description/, /does not match/, /invalid quantity/, /Status is blank/]) {
    assert.ok(result.flags.some(flag => pattern.test(flag)), String(pattern));
  }
});

test("later quote stages do not inflate intake-violation counts", () => {
  const result = assessQuoteRequestHygiene(row({"O&M Status": "Quote Pending Approval"}), columns);
  assert.deepEqual(result.flags, []);
  assert.equal(result.observations.length, 1);
  assert.match(result.observations[0], /does not prove/);
});

test("selection prefers actual requests over later notes, then newest request revisions", () => {
  const report = buildQuoteRequestHygieneReport({columns: headers, rows: [
    row(),
    row({"Case Comments": "A later case note", "Case Comment Created By": "Note Author", "Case Comment Created Date": "2026-10-14T12:00:00Z"}),
    row({"Case Comments": "O&M_QUOTE_REQUEST\nPlease quote", "Case Comment Created By": "New Request Author", "Case Comment Created Date": "2026-10-15T12:00:00Z"}),
    row({"Case Number": "002", "O&M Status": "Remote Troubleshooting", "Case Comments": "Ordinary note"}),
    row({"Case Number": "003", "Case Comments": "Please quote the damage", "Case Comment Created By": "Incomplete Author"})
  ]});
  assert.equal(report.records.length, 2);
  assert.equal(report.flagged.length, 2);
  assert.deepEqual(report.authors.map(author => author.author).sort(), ["Incomplete Author", "New Request Author"]);
  assert.ok(report.issues.every(issue => issue.cases <= 2));
});

test("missing author is not attributed to owner and missing case IDs are not merged", () => {
  const report = buildQuoteRequestHygieneReport({columns: headers.filter(header => header !== "Case Comment Created By"), rows: [
    row({"Case Number": ""}), row({"Case Number": ""})
  ]});
  assert.equal(report.records.length, 2);
  assert.equal(report.authors[0].author, "Unknown comment author");
  assert.equal(report.authors[0].requests, 2);
});

test("missing report columns have explicit findings instead of invented compliance", () => {
  const report = buildQuoteRequestHygieneReport({columns: ["Case Number", "O&M Status"], rows: [{"Case Number": "1", "O&M Status": "Quote Requested"}]});
  assert.ok(report.records[0].flags.some(flag => /missing the Case Comment column/.test(flag)));
  assert.equal(report.records[0].author, "Unknown comment author");
  assert.deepEqual(buildQuoteRequestHygieneReport(null).records, []);
});

test("Care Cancellation, Escalation and Return comments are excluded from Data Hygiene", () => {
  const report = buildQuoteRequestHygieneReport({columns: headers, rows: [
    row({"Case Number": "010", "Case Comments": "O&M_ESCALATION\nSummary of Escalation\nCustomer wants an on-demand quote request expedited."}),
    row({"Case Number": "011", "Case Comments": "O&M_CARE_CANCELLATION\nReason For Cancellation: Service Experience"}),
    row({"Case Number": "012", "Case Comments": "O&M_RETURN\nReturn Reason Category: Other"}),
    row({"Case Number": "013", "Case Comments": "O&M_ESCALATION\nSev 2", "Case Comment Created Date": "2026-10-15T12:00:00Z"}),
    row({"Case Number": "013"})
  ]});
  assert.deepEqual(report.records.map(record => record.caseNumber), ["013"]);
  assert.match(report.records[0].comment, /O&M_QUOTE_REQUEST/);
});
