import test from "node:test";
import assert from "node:assert/strict";
import {alternateRequestType, quoteRequestCommentEvidence, preferQuoteRequestComment} from "../src/features/quoteRequestIntake/quoteRequestComment.js";
import {parseQuoteRequestCase} from "../src/features/autoDrafter/parseQuoteRequestCase.js";
import {prepareAutomaticDraft} from "../src/features/autoDrafter/automaticDraftGeneration.js";
import {resolveRangeNumber} from "../src/features/quoteDraftAgent/rangeValues.js";

const summary = `Site ID: 100
Case Number: 001
Customer Name: Synthetic Customer
Site Address: Synthetic Address
Problem Description: Failed microinverters
Scope Description: Replace failed Enphase microinverters
Technician Count: 2
Estimated Onsite Labor Hours: 3-4
Estimated Total Labor Hours: 6 to 8
Total Drive Hours: 1
Total Drive Miles: 1,000
Warranty Replacements:
Equipment: IQ8A
Quantity: 2
Serial Number(s): 123456789012
Warranty Status: Active
RMA Required: Yes
RMA Number: RMA-TEST`;

test("all supplied heading formats and dated annotations preserve fields, ranges and warranty entries", () => {
  for (const heading of [
    "10/9 - PS:\nQuote Request", "Quote Requests", "10/1 - PS: O&M_QUOTE_REQUEST",
    "Quote Request", "8/26 - PS: Quote Request", "10/9 - LT: quote request:"
  ]) {
    const comment = `${heading}\n${summary.split("\n").map(line => `?${line}`).join("\n")}`;
    assert.ok(quoteRequestCommentEvidence(comment).hasRequest, heading);
    const {request, parseWarnings} = parseQuoteRequestCase(comment);
    assert.equal(request.siteId, "100");
    assert.equal(request.caseNumber, "001");
    assert.equal(request.onsiteLaborHours, "3-4");
    assert.equal(request.totalLaborHours, "6 to 8", "raw range text is kept for the shared range rule");
    assert.equal(resolveRangeNumber(request.totalLaborHours), 8);
    assert.equal(request.driveMiles, 1000);
    assert.equal(request.warrantyReplacements[0].name, "IQ8A");
    assert.equal(request.warrantyReplacements[0].rmaRequired, "Yes");
    assert.equal(request.warrantyReplacements[0].serialNumbers, "123456789012");
    assert.ok(!parseWarnings.some(warning => /heading/.test(warning)));
  }
});

test("O&M_QUOTE and O&M_QUOTE_REQUEST headings are matched fuzzily", () => {
  for (const heading of [
    "O&M_QUOTE", "O&M_QUOTE_REQUEST", "o&m_quote_request", "O&M QUOTE REQUEST", "O & M Quote", "O&M-QUOTE-REQUEST",
    "OM_QUOTE", "O&amp;M_QUOTE_REQUEST", "O&M_QUOTE_REQ", "O&M_QUOTES", "**O&M_QUOTE_REQUEST**", "[O&M_QUOTE]",
    "O&M_QUOTE: Replace microinverters", "10/1 - PS: O&M QUOTE", "- O&M_Quote_Request:", "Quote_Request"
  ]) assert.equal(quoteRequestCommentEvidence(`${heading}\nScope Description: Replace microinverters`).hasHeading, true, heading);
  for (const comment of ["Customer asked about the O&M quote", "O&M_QUOTEX", "O&M Status: Quote Requested", "Quoted the homeowner"]) {
    assert.equal(quoteRequestCommentEvidence(comment).hasHeading, false, comment);
  }
});

test("field continuations and reordered sections are isolated instead of consuming neighboring fields", () => {
  const {request} = parseQuoteRequestCase(`Quote Request\n${summary.replace("Scope Description: Replace failed Enphase microinverters",
    "Scope Description:\nReplace failed Enphase microinverters\nVerify operation after installation")}\nProducts\nItem Name: IQ Cable\nQuantity: 5`);
  assert.equal(request.scopeDescription, "Replace failed Enphase microinverters\nVerify operation after installation");
  assert.equal(request.warrantyReplacements[0].quantity, "2");
  assert.equal(request.products[0].quantity, "5");
  assert.equal(request.customer, "Synthetic Customer");
});

test("structured requests do not require the legacy marker and ordinary notes cannot create blank drafts", () => {
  assert.ok(quoteRequestCommentEvidence(summary).hasRequest);
  for (const comment of ["Site ID: 100\nCase Number: 001\nCustomer called to confirm arrival.", "10/9 - PS: Returned the customer's call"]) {
    assert.equal(quoteRequestCommentEvidence(comment).hasRequest, false);
    assert.match(prepareAutomaticDraft({caseNumber: "001", comment}).skip, /No structured scope/);
  }
  assert.equal(prepareAutomaticDraft({caseNumber: "001", comment: `Quote Request\n${summary}`}).request.warrantyReplacements.length, 1);
});

test("alternative quote options are explicit review items, not automatically combined prices", () => {
  const comment = `Quote Request\n${summary.replace("Scope Description: Replace failed Enphase microinverters",
    "Scope Description: Two quote options requested\nOption 1: Replace eight devices\nOption 2: Upgrade eleven devices")}`;
  const parsed = parseQuoteRequestCase(comment);
  assert.equal(parsed.request.multipleQuoteOptions, true);
  assert.match(parsed.request.scopeDescription, /Option 2/);
  assert.match(prepareAutomaticDraft({caseNumber: "001", comment}).skip, /Split the alternatives/);
});

test("source selection prefers actual requests over notes, then newer request revisions", () => {
  const request = `Quote Requests\n${summary}`;
  assert.equal(preferQuoteRequestComment("A later ordinary note", request, "2026-10-15", "2026-10-13"), false);
  assert.equal(preferQuoteRequestComment(request, "A later ordinary note", "2026-10-13", "2026-10-15"), true);
  assert.equal(preferQuoteRequestComment(request, request, "2026-10-15", "2026-10-13"), true);
  assert.equal(preferQuoteRequestComment(request, request, "invalid", "2026-10-13"), false);
});

test("O&M Care Cancellation, Escalation and Return comments are alternate requests, never quote requests", () => {
  const escalation = "O&M_ESCALATION\nEscalation Severity: Sev 2\nSite ID: 2769741\nCase Number(s): 20578378\nSummary of Escalation\nCustomer escalated a quote request delay.\nEstimated Onsite Labor Hours: 4";
  const cancellation = "O&M_CARE_CANCELLATION\n\nCustomer Information\nReason For Cancellation: Service Experience";
  const ret = "O&M_RETURN\nCase Number: 20541673\nReturn Reason\nReturn Reason Category: Conversion/Migration Issue";
  assert.equal(alternateRequestType(escalation).value, "escalation");
  assert.equal(alternateRequestType(cancellation).value, "care_cancellation");
  assert.equal(alternateRequestType(ret).value, "return");
  for (const variant of ["O & M Escalation", "[OM-CARE-CANCELATION]", "O&amp;M_RETURNS", "**O&M_Escalation**", "09/18/2026 - O&M_RETURN REQUEST"]) {
    assert.ok(alternateRequestType(`${variant}\nDetails`), variant);
  }
  assert.equal(alternateRequestType("Return Reason: damaged\nEscalation Severity: Sev 1"), null);
  assert.equal(alternateRequestType(`Quote Request\n${summary}\nO&M_ESCALATION mentioned later`), null);
  assert.equal(quoteRequestCommentEvidence(escalation).hasRequest, false);
  assert.equal(preferQuoteRequestComment(`Quote Request\n${summary}`, escalation, "2026-10-01", "2026-10-15"), true);
  assert.match(prepareAutomaticDraft({caseNumber: "20578378", comment: escalation}).skip, /Escalation request .*Alternate Requests/);
});
