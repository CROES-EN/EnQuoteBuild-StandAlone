import test from "node:test";
import assert from "node:assert/strict";
import {getRequestRoutingFlags} from "../src/features/autoDrafter/requestRoutingFlags.js";

const codes = (comment, status) => getRequestRoutingFlags(comment, status ? {status} : null).map(flag => flag.code);
test("microinverter purchase requests receive LPUP/TPUP review flag", () => {
  assert.ok(codes("Request new microinverters for an upgrade").includes("lpup_tpup"));
  assert.ok(codes("Products\nItem Name: IQ8A-72-2-US\nQuantity: 2").includes("lpup_tpup"));
  assert.deepEqual(codes("Replace solar panels and additional wiring.", "ACTIVE_CARE"), []);
});
test("device-only replacement routing uses three-state Care eligibility without invented coverage", () => {
  const comment = "Replace Enphase microinverters. Serial Number: 123456789012";
  assert.deepEqual(codes(comment, "ACTIVE_CARE"), ["microinverter_rma", "warranty_replacement", "enphase_care"]);
  assert.deepEqual(codes(comment, "NO_ACTIVE_CARE"), ["microinverter_rma", "warranty_replacement", "inside_sales"]);
  assert.deepEqual(codes(comment, "NOT_FOUND"), ["microinverter_rma", "warranty_replacement", "verify_care"]);
  assert.deepEqual(codes(comment), ["microinverter_rma", "warranty_replacement", "verify_care"]);
  assert.match(getRequestRoutingFlags("Replace Enphase microinverters.", null)[1].reason, /Collect device serials/);
});
test("Gateways and Envoys always require separate warranty check, including active Care", () => {
  for (const device of ["IQ Gateway", "Envoy"]) {
    const flags = getRequestRoutingFlags(`Replace ${device}. Serial Number: 123456789012`, {status: "ACTIVE_CARE"});
    assert.ok(flags.some(flag => flag.code === "gateway_warranty"));
    assert.ok(flags.some(flag => flag.code === "enphase_care"));
    assert.ok(!flags.some(flag => flag.reason.includes("20-25 year serial-device")));
  }
});
test("additional materials or upgrades prevent warranty-only Care classification", () => {
  for (const comment of ["Replace Enphase microinverters and wiring.", "Replace Enphase microinverters and critter guard."]) {
    assert.deepEqual(codes(comment, "ACTIVE_CARE"), ["microinverter_rma"]);
  }
  assert.deepEqual(codes("Upgrade Enphase microinverters.", "ACTIVE_CARE"), ["lpup_tpup"]);
  const comment = `O&M_QUOTE_REQUEST
Recommended Scope of Work
Scope Description: Replace Enphase microinverters
Products
Item Name: IQ8A-72-2-US
Quantity: 1
Additional Materials
Item Name: IQ Cable
Quantity: 1`;
  assert.deepEqual(codes(comment, "ACTIVE_CARE"), ["microinverter_rma"]);
});

test("warranty-only and possible RMAs are not purchases; explicit upgrades and conversions remain LPUP/TPUP", () => {
  const warranty = `Quote Request
Warranty Replacements
Equipment: IQ8A
Quantity: 2
Warranty Status: Unknown
RMA Required: Unknown`;
  assert.ok(codes(warranty).includes("microinverter_rma"));
  assert.ok(!codes(warranty).includes("lpup_tpup"));
  assert.ok(!codes(warranty.replace("Unknown", "Active")).includes("lpup_tpup"));
  assert.ok(!codes(`${warranty}\nRecommended Scope of Work\nScope Description: No upgrade; replace failed Enphase microinverters`).includes("lpup_tpup"));
  assert.ok(codes(`${warranty}\nRecommended Scope of Work\nScope Description: Purchase new Enphase microinverters for an upgrade`).includes("lpup_tpup"));
  assert.deepEqual(codes("Purchase Enphase microinverters to replace failed SolarBridge devices.", "ACTIVE_CARE"), ["lpup_tpup"]);
  assert.deepEqual(codes("Replace SolarBridge microinverters.", "ACTIVE_CARE"), ["microinverter_rma"]);
  const paidReplacement = `Quote Request
RMA Required: No
Scope Description: Replace Enphase microinverters
Products
Item Name: IQ8A
Quantity: 1`;
  assert.ok(codes(paidReplacement).includes("lpup_tpup"));
});
