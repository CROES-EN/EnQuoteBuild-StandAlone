import test from "node:test";
import assert from "node:assert/strict";
import {classifyQuoteRequest, requestCategoryCounts, REQUEST_TYPES} from "../src/features/autoDrafter/requestClassification.js";

test("case categories distinguish the five requested RMA, upgrade and mixed workflows", () => {
  for (const [comment, type] of [
    ["Panel RMA only", "panel_rma_only"],
    ["Panel RMA plus additional wiring", "panel_and_quote"],
    ["Replace Enphase microinverters", "enphase_rma"],
    ["Replace IQ Gateway", "enphase_rma"],
    ["Upgrade Enphase microinverters", "lpup_tpup"],
    ["Replace Enphase microinverters and repair wiring", "enphase_and_quote"],
    ["Replace IQ Gateway and repair AC cabling", "enphase_and_quote"]
  ]) assert.equal(classifyQuoteRequest(comment).type, type, comment);
  assert.ok(REQUEST_TYPES.some(option => option.label === "Enphase RMA + On-Demand"));
});

test("incidental panels and access work remain ordinary quotes, not mixed panel RMAs", () => {
  const classification = classifyQuoteRequest(`Quote Request
Problem Description: Panel leads damaged
Scope Description: Remove and reinstall array to access wiring and replace AC cabling
Products
Item Name: AC Cabling
Quantity: 1
Services
Service Name: Array Removal and Reinstallation
Quantity: 1`);
  assert.equal(classification.type, "on_demand");
  assert.equal(classification.hasPanelRequest, false);
});

test("there are exactly seven mutually exclusive categories and uncertainty becomes review notes", () => {
  assert.deepEqual(REQUEST_TYPES.map(option => option.label), ["Panel RMA", "Panel RMA + On-Demand", "Enphase RMA",
    "Enphase RMA + On-Demand", "LPUP/TPUP", "On-Demand only", "Unclassified"]);
  const unconfirmed = classifyQuoteRequest(`Quote Request\nScope Description: Install new solar panels\nProducts\nItem Name: Solar panel\nQuantity: 2`);
  assert.equal(unconfirmed.type, "on_demand");
  assert.match(unconfirmed.reviewNotes[0], /panel RMA is not confirmed/);
  const unknownMaker = classifyQuoteRequest(`Quote Request\nRMA Required: Yes\nScope Description: Replace SolarBridge microinverters\nProducts\nItem Name: SolarBridge microinverter\nQuantity: 1`);
  assert.equal(unknownMaker.type, "on_demand");
  assert.match(unknownMaker.reviewNotes.join(" "), /manufacturer is not established/);
  const both = classifyQuoteRequest(`Quote Request\nScope Description: Warranty replacement\nWarranty Replacements\nEquipment: Solar panel\nQuantity: 1\nWarranty Status: Active\nRMA Required: Yes\nEquipment: IQ8A\nQuantity: 1\nWarranty Status: Active\nRMA Required: Yes`);
  assert.equal(both.type, "panel_rma_only");
  assert.match(both.reviewNotes[0], /Another device RMA/);
  assert.equal(classifyQuoteRequest("Called the homeowner and left a voicemail").type, "unclassified");
  for (const comment of ["Panel RMA only", "Inspect solar panels for damage", "Replace IQ Gateway", "Upgrade Enphase microinverters"]) {
    assert.ok(REQUEST_TYPES.some(option => option.value === classifyQuoteRequest(comment).type), comment);
  }
});

test("warranty panels are distinguished from Enphase RMAs even when neither is a priced line", () => {
  const request = `Quote Requests
Scope Description: Warranty replacement
Warranty Replacements
Equipment: Solar panel
Quantity: 1
Warranty Status: Active
RMA Required: Yes`;
  assert.equal(classifyQuoteRequest(request).type, "panel_rma_only");
  assert.equal(classifyQuoteRequest(request.replace("Solar panel", "IQ8A")).type, "enphase_rma");
  assert.equal(classifyQuoteRequest(`${request.replace("Solar panel", "IQ8A")}\nAdditional Materials\nItem Name: IQ Cable\nQuantity: 1`).type, "enphase_and_quote");
  assert.equal(classifyQuoteRequest(`${request.replace("Solar panel", "IQ8A")}\nAdditional Materials\nItem Name: Enphase IQ Cable\nQuantity: 1`).type, "enphase_and_quote");
  assert.equal(classifyQuoteRequest(`${request.replace("Solar panel", "IQ8A")}\nServices\nService Name: Paid labor\nQuantity: 1`).type, "enphase_and_quote");
});

test("removing existing panels to reach Enphase equipment does not imply a panel RMA", () => {
  const comment = `Quote Request
RMA Required: Yes
Scope Description: Remove and reinstall panels to replace IQ Gateway
Products
Item Name: IQ Gateway
Quantity: 1`;
  assert.equal(classifyQuoteRequest(comment).type, "enphase_rma");
  assert.equal(classifyQuoteRequest(comment.replace("to replace IQ Gateway", "to access wiring and replace IQ Gateway")).type, "enphase_and_quote");
});

test("explicit RMA No does not produce contradictory RMA and upgrade categories", () => {
  assert.equal(classifyQuoteRequest(`Quote Request
RMA Required: No
Scope Description: Replace Enphase microinverters
Products
Item Name: IQ8A
Quantity: 1`).type, "lpup_tpup");
});

test("PV Module routing considers saved quote items as well as source items", () => {
  const source = `Quote Request
Scope Description: Replace failed equipment`;
  assert.equal(classifyQuoteRequest(source, [{name: "Compatible Replacement PV Module"}]).type, "panel_rma_only");
  assert.equal(classifyQuoteRequest(source, [
    {name: "Compatible Replacement PV Module"}, {name: "Mounting and Electrical Hardware"}
  ]).type, "panel_and_quote");
  assert.equal(classifyQuoteRequest(`${source}\nProducts\nItem Name: PV Module\nQuantity: 1`,
    [{name: "System Testing and Verification"}]).type, "panel_and_quote");
  assert.equal(classifyQuoteRequest(`${source}\nProducts\nItem Name: PV Module\nQuantity: 1\nAdditional Materials\nItem Name: Mounting Hardware\nQuantity: 1`,
    [{name: "PV Module"}]).type, "panel_rma_only");
  assert.equal(classifyQuoteRequest(`${source}\nProblem Description: PV Module was previously replaced`,
    [{name: "AC Cabling"}]).type, "on_demand");
});

test("case categories sort largest to smallest without mutating declarations, including zero-count groups", () => {
  const counts = requestCategoryCounts([
    {type: "panel_rma_only"}, {type: "enphase_and_quote"}, {type: "enphase_and_quote"},
    {type: "lpup_tpup"}, {type: "lpup_tpup"}, {type: "lpup_tpup"}
  ]);
  assert.deepEqual(counts.slice(0, 3).map(category => [category.value, category.count]), [
    ["lpup_tpup", 3], ["enphase_and_quote", 2], ["panel_rma_only", 1]
  ]);
  assert.equal(counts.length, REQUEST_TYPES.length);
  assert.ok(counts.slice(3).every(category => category.count === 0));
  assert.equal(REQUEST_TYPES[0].value, "panel_rma_only");
});
