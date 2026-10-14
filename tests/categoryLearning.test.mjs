import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {build} from "esbuild";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
// One bundle so classifier, draft engine and learning store share the same runtime learning state.
async function bundle() {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./src/features/autoDrafter/requestClassification.js";',
        'export * from "./src/features/autoDrafter/pvModuleRecognition.js";',
        'export * from "./src/features/autoDrafter/categoryLearning.js";',
        'export {parseQuoteRequestCase} from "./src/features/autoDrafter/parseQuoteRequestCase.js";',
        'export {generateQuoteDraft} from "./src/features/quoteDraftAgent/draftEngine.js";',
        'export {buildAutoDrafterAccuracy} from "./src/features/supervisorDashboard/supervisorInsights.js";',
        'export {saveCategoryCorrection, forgetCategoryCorrection, forgetCategoryRule, loadLearnedSwaps} from "./src/features/quoteDraftAgent/learnedSwapsStore.js";',
        'export {findLearnedCorrection} from "./src/features/quoteDraftAgent/learnedCorrections.js";'
      ].join("\n"),
      resolveDir: path.resolve("."), loader: "js"
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", alias: {"@": path.resolve("src")}
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const lib = await bundle();

const request = ({caseNumber, scope, products = "None", services = "", materials = "None", warranty = "None", rma = "No", findings = ""}) => `Quote Request
Quote Category: Other
RMA Required: ${rma}
Site Information
Site ID: 1000
Case Number: ${caseNumber}
Customer Name: Test Customer
Findings
Problem Description: ${findings || "Reported issue."}
Recommended Scope of Work
Scope Description: ${scope}
Labor
Technician Count: 2
Estimated Onsite Labor Hours: 1
Estimated Total Labor Hours: 2
Travel
Total Drive Hours: 1
Total Drive Miles: 30
Products
${products}
Services
${services}
Additional Materials
${materials}
Warranty Replacements
${warranty}
Technician Recommendations
Recommendation: As described.`;

const item = (name, notes = "") => `Item Name: ${name}\nQuantity: 1\nUnit: Each\nNotes: ${notes}`;
const service = (name, notes = "") => `Service Name: ${name}\nQuantity: 1\nUnit: Job\nNotes: ${notes}`;
const unknownMaterial = `Item Name: Unknown\nQuantity: Unknown\nUnit: Unknown\nNotes: To be determined.`;
const noEnphaseWarranty = `Equipment: None\nQuantity: N/A\nSerial Number(s): N/A\nWarranty Status: Unknown\nRMA Required: No\nRMA Number: N/A\nNotes: No Enphase equipment identified for replacement.`;

const REC = request({caseNumber: "20196942", findings: "Low voltage on module associated with MI 9664.",
  scope: "Evaluate and replace failed/low-voltage REC Alpha Pure REC395AA Pure module associated with MI 9664. Verify system operation following module replacement.",
  products: item("REC Alpha Pure REC395AA Pure Solar Module", "Existing module S/N FBB-0000000000."),
  services: service("Solar Module Replacement", "Remove and replace low-voltage module; verify system performance and reporting."),
  materials: unknownMaterial, warranty: noEnphaseWarranty});
const QCELLS = request({caseNumber: "20402423",
  scope: "Remove existing degraded solar module and install replacement Qcells Q.PEAK DUO BLK ML-G10+ 400 module. Reconnect existing wiring/connectors and reinstall mounting hardware as required.",
  products: item("Qcells Q.PEAK DUO BLK ML-G10+ 400 Solar Module", "400 W module replacement"),
  services: service("Solar Module Replacement", "Remove and replace existing solar module, reconnect wiring, verify operation"),
  materials: unknownMaterial, warranty: noEnphaseWarranty});
const SOLARIA = request({caseNumber: "20444127", rma: "Unknown",
  scope: "Access roof via ladder; troubleshoot affected module; perform DC voltage testing; inspect wiring, connectors, and cabling; replace defective module and/or associated components if confirmed faulty.",
  products: item("Solar Module", "Suspect Solaria PowerXT-355R AC module; replacement pending confirmation of failure."),
  services: [service("Solar Module Troubleshooting", "Module-level diagnostics and electrical testing."),
    service("Solar Module Replacement", "Perform only if module failure is confirmed.")].join("\n"),
  materials: unknownMaterial});
const CARE_SUBSCRIPTION = request({caseNumber: "20342612", findings: "Failed BC board replaced; site fully operational.",
  scope: "Enphase Care subscription quote only. No current service work required.",
  services: service("Enphase Care Subscription Consultation and Quote", "Subscription options only. No repair or field service requested.")});
const CARE_ENROLLMENT = request({caseNumber: "20198948", scope: "Enphase Care enrollment quote and enrollment service.",
  products: "None required", materials: "None required",
  services: service("Enphase Care Enrollment", "Customer discussed Enphase Care enrollment onsite and requested quote follow-up.")});

function withBridge(records = []) {
  const store = new Map(records.map(record => [record.id, {...record}]));
  globalThis.window = {enquoteLocal: {collections: {
    list: async () => [...store.values()].map(record => ({...record})),
    create: async (_name, record) => {store.set(record.id, {...record}); return record;},
    update: async (_name, id, changes) => {store.set(id, {...store.get(id), ...changes, id}); return store.get(id);},
    delete: async (_name, id) => {store.delete(id);}
  }}};
  return store;
}

test("third-party solar modules named only by brand/series are recognized as PV modules", () => {
  for (const name of [
    "REC Alpha Pure REC395AA Pure Solar Module", "Qcells Q.PEAK DUO BLK ML-G10+ 400 Solar Module", "Solar Module",
    "Compatible Replacement PV Module", "Solaria PowerXT-355R AC module", "ZNSHINE Solar Panel", "Module",
    "Q.PEAK DUO BLK ML-G10+ 400", "REC395AA", "SunPower X21-345", "Silfab SIL-370 NX"
  ]) assert.equal(lib.isPvModuleName(name), true, name);
  assert.equal(lib.isPvModuleName("Solaria PV Module Replacement", {product: true}), true, "a Products line names the replacement module");
  assert.equal(lib.isPvModuleName("Module Plate", {product: true}), false);
  assert.equal(lib.isPvModuleName("Module-level diagnostics", {product: true}), false);
  for (const name of [
    "QD 12AWG Cable (Commercial) w/120 Male Connectors - 2.0m Max Module Pitch", "Ironridge UFO-CL-01-B1, Module Clamps",
    "Solar Panel Clips (Pack of 50)", "Solar Panel Bird Wire Critter Guard Roll Kit", "Solar Module Replacement",
    "Solar Module Troubleshooting", "Module-level diagnostics", "IQ Battery 5P", "Cell Modem Module", "Battery Module",
    "Communications Module", "IQ8M Microinverter", "Main Service Panel", "Unknown", "None required"
  ]) assert.equal(lib.isPvModuleName(name), false, name);
});

test("REC, Qcells and Solaria module replacements are Panel RMA, not On-Demand", () => {
  for (const [label, comment, draftItems] of [
    ["REC", REC, [{name: "REC Alpha Pure REC395AA Pure Solar Module"}, {name: "Solar Module Replacement", zero_priced_service: true}]],
    ["Qcells", QCELLS, [{name: "Qcells Q.PEAK DUO BLK ML-G10+ 400 Solar Module"}, {name: "Solar Module Replacement", tax_code: "SS300220"}]],
    ["Solaria", SOLARIA, []]
  ]) {
    for (const items of [[], draftItems]) {
      const result = lib.classifyQuoteRequest(comment, items);
      assert.equal(result.type, "panel_rma_only", `${label}: ${result.reason}`);
      assert.match(result.reason, /PV module/);
    }
  }
  assert.match(lib.classifyQuoteRequest(REC).reason, /RMA Required: No/);
});

test("a module request with genuinely separate paid work stays Panel RMA + On-Demand", () => {
  const mixed = request({caseNumber: "1", scope: "Replace module and add critter guard.",
    products: item("REC Alpha Pure REC395AA Pure Solar Module"), materials: item("Critter Guard Roll")});
  assert.equal(lib.classifyQuoteRequest(mixed).type, "panel_and_quote");
});

test("the Solaria module is never priced as a QD cable", () => {
  const draft = lib.generateQuoteDraft(lib.parseQuoteRequestCase(SOLARIA).request);
  assert.ok(!draft.items.some(line => /Max Module Pitch|QD 12AWG/i.test(line.name)), draft.items.map(line => line.name).join(", "));
  const module = draft.items.find(line => line.requested_name === "Solar Module");
  assert.ok(module, "requested module is kept");
  assert.equal(module.confidence, "low", "an unmatched module is a visible placeholder, not a catalog match");
  assert.equal(module.name, "Solar Module");
  for (const comment of [REC, QCELLS]) {
    const items = lib.generateQuoteDraft(lib.parseQuoteRequestCase(comment).request).items;
    assert.ok(items.every(line => !/clamp|clip|pitch/i.test(line.name)), items.map(line => line.name).join(", "));
  }
});

test("Enphase Care subscription and enrollment requests get the Enphase Care category", () => {
  for (const comment of [CARE_SUBSCRIPTION, CARE_ENROLLMENT]) {
    const result = lib.classifyQuoteRequest(comment, [{name: "Enphase Care Enrollment"}]);
    assert.equal(result.type, "enphase_care", result.reason);
    assert.equal(result.label, "Enphase Care");
  }
  const careWithWork = request({caseNumber: "2", scope: "Replace failed IQ8 microinverter and quote Enphase Care subscription.",
    products: item("IQ8M Microinverter"), services: service("Enphase Care Enrollment")});
  assert.notEqual(lib.classifyQuoteRequest(careWithWork).type, "enphase_care");
  assert.notEqual(lib.classifyQuoteRequest(QCELLS).type, "enphase_care");
  assert.ok(lib.REQUEST_TYPES.some(option => option.value === "enphase_care"));
});

test("reviewer category corrections and learned rules are applied, stored beside swaps, and forgettable", async () => {
  const store = withBridge([{id: "swap:mystery", phrase: "mystery", catalogName: "IQ Gateway", taughtAt: "2026-01-01"}]);
  try {
    const repair = request({caseNumber: "555", scope: "Replace damaged conduit run and repair Acme Widget housing.",
      materials: item("Acme Widget Housing")});
    assert.equal(lib.classifyQuoteRequest(repair).type, "on_demand");

    await lib.saveCategoryCorrection({caseNumber: "555", category: "enphase_rma", automaticCategory: "on_demand",
      note: "Covered under warranty", taughtBy: "lead@example.com"});
    let result = lib.classifyQuoteRequest(repair);
    assert.equal(result.type, "enphase_rma");
    assert.equal(result.automaticType, "on_demand");
    assert.equal(result.learned.source, "case");
    assert.match(result.reason, /corrected by lead@example.com: Covered under warranty/);
    assert.equal(lib.classifyQuoteRequest(repair.replace("Case Number: 555", "Case Number: 556")).type, "on_demand",
      "a per-case correction does not leak to other cases");

    await lib.saveCategoryCorrection({caseNumber: "555", category: "lpup_tpup", taughtBy: "lead@example.com",
      rule: {phrase: "Acme Widget", category: "lpup_tpup"}});
    result = lib.classifyQuoteRequest(repair.replace("Case Number: 555", "Case Number: 777"));
    assert.equal(result.type, "lpup_tpup", "the learned rule applies to new cases");
    assert.equal(result.learned.source, "rule");
    assert.match(result.reason, /Learned rule by lead@example.com: requests mentioning "Acme Widget"/);
    assert.equal(lib.classifyQuoteRequest(repair, [], {caseNumber: "555"}).learned.source, "case", "case correction beats a rule");

    const unknownModule = request({caseNumber: "888", scope: "Swap the failed Zeta-9 laminate on the roof.",
      products: item("Zeta-9 laminate")});
    assert.equal(lib.classifyQuoteRequest(unknownModule).type, "on_demand");
    await lib.saveCategoryCorrection({caseNumber: "888", category: "panel_rma_only",
      rule: {phrase: "zeta-9 laminate", category: lib.PV_MODULE_RULE}});
    await lib.forgetCategoryCorrection("888");
    assert.equal(lib.isPvModuleName("Zeta-9 Laminate 400W"), true, "PV module phrases are learned too");
    assert.equal(lib.classifyQuoteRequest(unknownModule).type, "panel_rma_only");

    await assert.rejects(lib.saveCategoryCorrection({caseNumber: "1", category: "on_demand", rule: {phrase: "ab", category: "on_demand"}}), /at least 4/);

    assert.equal(lib.findLearnedCorrection("mystery"), "IQ Gateway", "item swaps still load beside category records");
    assert.equal(lib.buildAutoDrafterAccuracy([], [...store.values()]).learnedSwaps, 1, "category records are not counted as item swaps");

    await lib.forgetCategoryRule("Acme Widget");
    await lib.forgetCategoryCorrection("555");
    await lib.forgetCategoryRule("zeta-9 laminate");
    assert.equal(lib.classifyQuoteRequest(repair).type, "on_demand");
    assert.equal(lib.isPvModuleName("Zeta-9 laminate"), false);
    assert.deepEqual([...store.keys()], ["swap:mystery"]);
  } finally {
    delete globalThis.window;
    lib.setRuntimeCategoryLearning([]);
  }
});
