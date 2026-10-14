import test from "node:test";
import assert from "node:assert/strict";
import {suggestPanelRequestType} from "../src/features/autoDrafter/panelRequestClassification.js";

test("automatically separates panel RMA-only, mixed work, ambiguous mentions and electrical panels", () => {
  for (const [comment, expected] of [
    ["Panel RMA for cracked solar panels.", "panel_rma_only"],
    ["Warranty replacement of PV modules.", "panel_rma_only"],
    ["Panel RMA plus additional wiring required.", "panel_and_quote"],
    ["Replace solar panels and microinverters.", "panel_review"],
    ["Panel RMA with On-Demand quote for paid labor.", "panel_and_quote"],
    ["Inspect solar panels for damage.", "panel_review"],
    ["No panel RMA required; inspect modules.", "panel_review"],
    ["Replace the main panel and breaker panel.", "no_panel"],
    ["Gateway replacement.", "no_panel"]
  ]) assert.equal(suggestPanelRequestType(comment).type, expected, comment);
});

test("existing panels and panel accessories do not turn cabling or access work into a panel request", () => {
  const cabling = `10/6 - PS: Quote Request
Quote Category: Array Removal and Reinstallation
RMA Required: Unknown
Findings
Problem Description: Critter damage
Diagnostic Findings: AC wiring and panel leads damaged throughout the array
Recommended Scope of Work
Scope Description: Remove and reinstall array as needed to access damaged wiring, repair critter damage and replace AC cabling.
Products
Item Name: AC Cabling
Quantity: 1
Services
Service Name: Array Removal and Reinstallation
Quantity: 1
Service Name: Electrical Correction
Quantity: 1
Additional Materials
Item Name: AC Cabling for Entire System Size
Quantity: 1
Warranty Replacements
Equipment: Microinverters
Quantity: Unknown
Warranty Status: Unknown
RMA Required: Unknown
Technician Recommendations
Recommendation: Remove panels to access and repair wiring and panel leads`;
  assert.equal(suggestPanelRequestType(cabling).type, "no_panel");
  for (const scope of [
    "Remove panels to access damaged wiring and reinstall the existing panels.",
    "Repair damaged panel leads and AC cabling.",
    "Replace solar panel clips and add wiring.",
    "No panel RMA required; quote wiring only."
  ]) {
    assert.equal(suggestPanelRequestType(cabling.replace(/Scope Description: .*/, `Scope Description: ${scope}`)).type, "no_panel", scope);
  }
});

test("historical panel findings and an unrelated microinverter RMA cannot create a mixed panel quote", () => {
  const comment = `Quote Requests
RMA Required: Yes
Findings
Problem Description: Earlier cracked solar panels were already repaired
Recommended Scope of Work
Scope Description: Replace Enphase microinverters and IQ Cable
Products
Item Name: IQ8A
Quantity: 1
Warranty Replacements
Equipment: Microinverters
Quantity: 1
Warranty Status: Active
RMA Required: Yes`;
  assert.equal(suggestPanelRequestType(comment).type, "no_panel");
});

test("warranty panels need not be priced, and panel RMA handling is not separate paid work", () => {
  const comment = `Quote Request
Recommended Scope of Work
Scope Description: Manufacturer warranty replacement
Services
Service Name: Array Removal and Reinstallation
Quantity: 1
Warranty Replacements
Equipment: Solar panel
Quantity: 1
Warranty Status: Active
RMA Required: Yes`;
  const only = suggestPanelRequestType(comment);
  assert.equal(only.type, "panel_rma_only");
  assert.match(only.reason, /Warranty Replacements.*need not appear among priced/);
  const mixed = suggestPanelRequestType(comment.replace("Services", "Additional Materials\nItem Name: AC Cabling\nQuantity: 1\nServices"));
  assert.equal(mixed.type, "panel_and_quote");
  assert.match(mixed.reason, /Warranty Replacements/);
  assert.equal(suggestPanelRequestType(comment.replace("Warranty Status: Active", "Warranty Status: Inactive").replace("RMA Required: Yes", "RMA Required: No")).type, "panel_review");
});

test("structured items detect extra materials but ignore None and unrelated findings", () => {
  const base = `O&M_QUOTE_REQUEST
RMA Required: Yes
Findings
Problem Description: Solar panel damage
Diagnostic Findings: Existing gateway online
Recommended Scope of Work
Scope Description: Panel RMA
Products
Item Name: Solar panel
Quantity: 1
Services
Service Name: None
Additional Materials
Item Name: None`;
  assert.equal(suggestPanelRequestType(base).type, "panel_rma_only");
  assert.equal(suggestPanelRequestType(base.replace("Item Name: None", "Item Name: IQ Cable\nQuantity: 2")).type, "panel_and_quote");
  assert.equal(suggestPanelRequestType(base.replace("Service Name: None", "Service Name: Critter guard installation\nQuantity: 1")).type, "panel_and_quote");
  assert.equal(suggestPanelRequestType(base.replace("Item Name: Solar panel", "Item Name: Solar panel clips")).type, "panel_and_quote");
});

test("revised comments recalculate classification without overrides", () => {
  assert.equal(suggestPanelRequestType("Panel RMA only").type, "panel_rma_only");
  assert.equal(suggestPanelRequestType("Panel RMA plus gateway replacement").type, "panel_and_quote");
});

test("any quoted PV Module item mandates panel RMA routing, and any other item mandates mixed routing", () => {
  for (const name of ["PV Module", "Compatible SunPower Replacement PV Module", "pv module", "PV-Module Replacement"]) {
    const comment = `Quote Request
RMA Required: Unknown
Scope Description: Replace failed equipment
Products
Item Name: ${name}
Quantity: 1`;
    const only = suggestPanelRequestType(comment);
    assert.equal(only.type, "panel_rma_only", name);
    assert.match(only.reason, /PV Module line item detected/);
    assert.equal(suggestPanelRequestType(`${comment}\nAdditional Materials\nItem Name: Mounting and Electrical Hardware\nQuantity: Unknown`).type, "panel_and_quote");
    assert.equal(suggestPanelRequestType(`${comment}\nServices\nService Name: System Testing and Verification\nQuantity: 1`).type, "panel_and_quote");
    assert.equal(suggestPanelRequestType(`${comment}\nServices\nService Name: PV Module Replacement\nQuantity: 1`).type, "panel_rma_only");
    assert.equal(suggestPanelRequestType(comment.replace("Unknown", "No")).type, "panel_rma_only");
  }
});
