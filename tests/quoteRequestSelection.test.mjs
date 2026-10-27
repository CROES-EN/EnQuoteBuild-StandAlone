import test from "node:test";
import assert from "node:assert/strict";
import {selectAwaitingQuoteRequests, qualifyingQuoteRequestRows, quoteRequestColumns} from "../src/features/autoDrafter/quoteRequestSelection.js";

const columns = ["Case Number", "Case Comments: Comment", "Case Comment Created Date"];
const row = (number, comment, date = "2026-10-23") => ({
  [columns[0]]: number, [columns[1]]: comment, [columns[2]]: date
});
const table = rows => ({columns, rows});

test("requests are deduplicated and preferred over newer plain notes", () => {
  const request = row("123", "O&M_QUOTE\nScope Description: Repair");
  assert.deepEqual(qualifyingQuoteRequestRows(table([
    request, row("123", "Called homeowner", "2026-10-26")
  ])), [request]);
  const revision = row("123", "O&M_QUOTE\nScope Description: Revised", "2026-10-27");
  assert.deepEqual(qualifyingQuoteRequestRows(table([request, revision])), [revision]);
});

test("alternate-only cases are excluded; mixed cases retain their quote request", () => {
  const request = row("456", "O&M_QUOTE");
  assert.deepEqual(selectAwaitingQuoteRequests(table([
    row("123", "O&M_ESCALATION"), row("123", "Called homeowner"),
    row("456", "O&M_RETURN"), request
  ])), [request]);
});

test("any existing quote and manual removals are excluded with normalized case numbers", () => {
  const rows = [row("000123", "O&M_QUOTE"), row("#456", "O&M_QUOTE"), row("789", "O&M_QUOTE")];
  assert.deepEqual(selectAwaitingQuoteRequests(table(rows),
    [{case_number: "#123", status: "cancelled"}],
    [{caseNumber: "00456", removedFromAutoDrafter: true}, {caseNumber: "789", removedFromAutoDrafter: false}]
  ), [rows[2]]);
});

test("missing case numbers are preserved individually and loose headers are supported", () => {
  const rows = [row("", "O&M_QUOTE"), row("", "O&M_QUOTE")];
  assert.deepEqual(selectAwaitingQuoteRequests(table(rows)), rows);
  assert.deepEqual(selectAwaitingQuoteRequests({columns: ["Comment"], rows: [{Comment: "O&M_QUOTE"}]}), [{Comment: "O&M_QUOTE"}]);
  assert.equal(quoteRequestColumns(columns).comment, columns[1]);
  assert.deepEqual(selectAwaitingQuoteRequests(null), []);
});
