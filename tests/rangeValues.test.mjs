import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {describeRangeResolution, resolveRangeNumber, resolveRangeValue} from "../src/features/quoteDraftAgent/rangeValues.js";
import {prepareAutomaticDraft} from "../src/features/autoDrafter/automaticDraftGeneration.js";

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [path.join("src", "features", "quoteDraftAgent", "draftEngine.js")], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", alias: {"@": path.resolve("src")}
});
const engineModule = {exports: {}};
new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, engineModule, engineModule.exports);
const {generateQuoteDraft} = engineModule.exports;

test("ranges resolve to the upper bound and digits are never joined", () => {
  for (const [input, expected] of [
    ["16-24", 24], ["16 - 24", 24], ["16\u201324", 24], ["16\u201424", 24], ["16\u221224", 24], ["16 to 24", 24],
    ["between 16 and 24", 24], ["32-48 hours", 48], ["2-3 hours", 3], ["0.5-0.75 hours", 0.75], ["20-40 ft", 40],
    ["1,200", 1200], ["4", 4], [6, 6], ["Unknown", null], ["", null], [null, null], ["N/A", null]
  ]) assert.equal(resolveRangeNumber(input), expected, JSON.stringify(input));
});

test("minutes convert to hours only for hour fields", () => {
  assert.equal(resolveRangeNumber("30-45 minutes from Denver", {unit: "hours"}), 0.75);
  assert.equal(resolveRangeNumber("90 min", {unit: "hours"}), 1.5);
  assert.equal(resolveRangeNumber("1.5 hours", {unit: "hours"}), 1.5);
  assert.equal(resolveRangeNumber("30-45 minutes"), 45, "non-hour fields keep the raw number");
});

test("alternative numbers resolve to the largest and are flagged", () => {
  const resolved = resolveRangeValue("1 technician if microinverter replacement is required; 2 technicians if PV module replacement is required");
  assert.equal(resolved.value, 2);
  assert.equal(resolved.ambiguous, true);
  assert.equal(resolveRangeNumber("2 preferred (1 feasible)"), 2);
  assert.equal(resolveRangeNumber("IQ8A x 3"), 3, "digits inside model names are ignored");
  assert.match(describeRangeResolution("Technician count", "2 preferred (1 feasible)"), /resolved to 2 \(largest of the numbers given\)/);
});

const comment = ({technicians, onsite, total, driveHours, driveMiles, quantity = "1"}) => `O&M_QUOTE_REQUEST
Site Information
Site ID: 123456
Case Number: 20205804
Recommended Scope of Work
Scope Description: Replace PV modules.
Labor
Technician Count: ${technicians}
Estimated Onsite Labor Hours: ${onsite}
Estimated Total Labor Hours: ${total}
Total Drive Hours: ${driveHours}
Total Drive Miles: ${driveMiles}
Products
Item Name: IQ8A
Quantity: ${quantity}`;

test("every draft input follows the same range rule (real requests that were over-quoted)", () => {
  const cases = [
    [{technicians: "2", onsite: "16-24", total: "32-48", driveHours: "Unknown", driveMiles: "Unknown"}, {fst: 2, hours: 24, travel: 0, miles: 0}],
    [{technicians: "1", onsite: "1-2 hours", total: "1-2 hours", driveHours: "30-45 minutes from Denver", driveMiles: "Unknown"}, {fst: 1, hours: 2, travel: 0.75, miles: 0}],
    [{technicians: "1 technician if microinverter replacement is required; 2 technicians if PV module replacement is required",
      onsite: "2-3 hours", total: "Unknown", driveHours: "1.5 hours", driveMiles: "Unknown"}, {fst: 2, hours: 3, travel: 1.5, miles: 0}],
    [{technicians: "2 preferred (1 feasible)", onsite: "2\u20133 hours", total: "4-6 hours", driveHours: "0.5-0.75 hours", driveMiles: "40-60"}, {fst: 2, hours: 3, travel: 0.75, miles: 60}],
    [{technicians: "2", onsite: "Unknown", total: "32-48", driveHours: "1", driveMiles: "112"}, {fst: 2, hours: 48, travel: 1, miles: 112}]
  ];
  for (const [fields, expected] of cases) {
    const prepared = prepareAutomaticDraft({caseNumber: "20205804", siteId: "123456", comment: comment(fields)});
    const draft = generateQuoteDraft(prepared.request);
    assert.deepEqual({fst: draft.fst_count, hours: draft.labor_hours, travel: draft.travel_hours, miles: draft.miles_traveled}, expected, JSON.stringify(fields));
  }
});

test("item quantities use the same rule", () => {
  const prepared = prepareAutomaticDraft({caseNumber: "1", siteId: "1", comment: comment({technicians: "1", onsite: "2", total: "2", driveHours: "1", driveMiles: "1", quantity: "3\u20134"})});
  const draft = generateQuoteDraft(prepared.request);
  const item = draft.items.find(line => /IQ8A/i.test(line.name));
  assert.equal(item.quantity, 4);
});

test("unmatched parts take their category from the name, never a device price from the notes", () => {
  const {placeholderUnitPrice, CATEGORY_AVERAGES} = engineModule.exports;
  const bolts = placeholderUnitPrice("SunPower Racking Rail Bolts", "For microinverter mounting");
  assert.equal(bolts.category, "Mounting / Racking");
  assert.equal(bolts.unitPrice, CATEGORY_AVERAGES["Mounting / Racking"]);
  assert.equal(placeholderUnitPrice("Spare part", "for microinverter replacement").category, "Wiring & Cable Management");
  assert.equal(placeholderUnitPrice("Wire nut", "").category, "Wiring & Cable Management");
  assert.equal(placeholderUnitPrice("IQ8 micro", "").category, "Microinverters");
});