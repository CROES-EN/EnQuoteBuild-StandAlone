import test from "node:test";
import assert from "node:assert/strict";
import {automaticSourceInputCorrection, exceededSourceInputs} from "../src/features/autoDrafter/sourceInputCorrections.js";

const comment = `O&M_QUOTE_REQUEST
Site Information
Site ID: 6350734
Case Number: 20205804
Labor
Number of Technicians: 2
Estimated Onsite Labor Hours: 16-24
Estimated Total Labor Hours: 32-48
Travel
Total Drive Hours: 30-45 minutes`;
const record = {caseNumber: "20205804", sourceComment: comment, parseWarnings: [], draft: {
  fst_count: 2, labor_hours: 1624, travel_hours: 3045, miles_traveled: 0,
  notes: "2 technicians assigned. Estimated onsite labor hours: 1624 hours. Labor rate assumed at $125.00/hour."
}};

test("unsent, unedited drafts with joined range digits are corrected to the request's upper bound", () => {
  const fixed = automaticSourceInputCorrection(record, comment);
  assert.equal(fixed.draft.labor_hours, 24);
  assert.equal(fixed.draft.travel_hours, 0.75);
  assert.equal(fixed.draft.fst_count, 2);
  assert.match(fixed.draft.notes, /Estimated onsite labor hours: 24 hours\./);
  assert.match(fixed.parseWarnings.at(-1), /Labor hours 1624 → 24 \(request: "16-24"\)/);
  assert.equal(fixed.editedBeforeSend, undefined, "automatic correction is not a reviewer edit");
  assert.equal(automaticSourceInputCorrection(fixed, comment), null, "corrections run once");
});

test("sent or reviewer-edited drafts are never changed automatically", () => {
  assert.equal(automaticSourceInputCorrection({...record, sentToQuotes: true}, comment), null);
  assert.equal(automaticSourceInputCorrection({...record, editedBeforeSend: true}, comment), null);
  assert.deepEqual(exceededSourceInputs(record.draft, comment).map(check => check.field).sort(), ["labor_hours", "travel_hours"]);
  assert.deepEqual(exceededSourceInputs({...record.draft, labor_hours: 20, travel_hours: 0.5}, comment), [], "values within the request are kept");
});

test("unmatched lines priced from their notes are lowered to the price their name implies", () => {
  const bolts = {name: "SunPower Racking Rail Bolts", requested_name: "SunPower Racking Rail Bolts", quantity: 32, unit_price: 215.49,
    total: 6895.68, confidence: "low", source_line: {kind: "material", notes: "For microinverter mounting"}};
  const averages = {Microinverters: 215.49, "Mounting / Racking": 16.45};
  const price = () => ({category: "Mounting / Racking", unitPrice: 16.45, section: "Racking"});
  const draft = {fst_count: 2, labor_hours: 24, travel_hours: 0.75, items: [bolts, {...bolts, confidence: "high"}, {...bolts, unit_price: 200}]};
  const fixed = automaticSourceInputCorrection({...record, draft}, comment, {placeholderPrice: price, categoryAverages: averages});
  assert.equal(fixed.draft.items[0].unit_price, 16.45);
  assert.equal(fixed.draft.items[0].total, 526.4);
  assert.equal(fixed.draft.items[1].unit_price, 215.49, "reviewer-swapped (high confidence) lines are kept");
  assert.equal(fixed.draft.items[2].unit_price, 200, "hand-entered prices are kept");
  assert.match(fixed.parseWarnings.at(-1), /SunPower Racking Rail Bolts placeholder price \$215\.49 → \$16\.45 each/);
  assert.equal(automaticSourceInputCorrection(fixed, comment, {placeholderPrice: price, categoryAverages: averages}), null, "repricing runs once");
});