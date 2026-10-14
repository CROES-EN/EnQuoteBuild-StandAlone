import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {parseQuoteRequestCase} from "../src/features/autoDrafter/parseQuoteRequestCase.js";
import {suggestPanelRequestType} from "../src/features/autoDrafter/panelRequestClassification.js";

const require = createRequire(import.meta.url);
async function bundle(entry, mocks = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node",
    format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "preview-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path)
        ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports
  );
  return module.exports;
}

const engine = await bundle(path.join("src", "features", "quoteDraftAgent", "draftEngine.js"));
const passthrough = ({children}) => React.createElement("div", null, children);

async function renderPreview(draft) {
  let stateIndex = 0;
  const states = [true, "", draft, null, false, [], null, {parseWarnings: [], classification: null, routingFlags: []}, null];
  const icon = () => null;
  const mocks = {
    react: {...React, useState: () => [states[stateIndex++], () => {}]},
    "lucide-react": Object.fromEntries(["AlertTriangle", "ArrowLeftRight", "BookOpen", "Check", "ExternalLink", "Info", "Plus",
      "ShieldAlert", "ShieldCheck", "Sparkles", "Trash2"].map(name => [name, icon])),
    sonner: {toast: {}},
    "@/api/dataClient": {getCurrentUser: async () => null},
    "@/components/autoDrafter/CatalogPickerDialog": Object.assign(() => null, {default: () => null}),
    "@/components/ui/button": {Button: passthrough},
    "@/components/ui/dialog": {
      Dialog: passthrough, DialogContent: passthrough, DialogDescription: passthrough,
      DialogFooter: passthrough, DialogHeader: passthrough, DialogTitle: passthrough
    },
    "@/components/ui/textarea": {Textarea: passthrough},
    "@/components/links/ExternalIdLinks": {
      CaseNumberLink: ({caseNumber}) => caseNumber,
      SiteIdLink: ({siteId}) => siteId
    }
  };
  const component = await bundle(path.join("src", "features", "quoteDraftAgent", "QuoteDraftButton.jsx"), mocks);
  return renderToStaticMarkup(React.createElement(component.default, {onApply() {}}));
}

const request = names => ({
  siteId: "12345", caseNumber: "00123456", technicianCount: 1, onsiteLaborHours: 2,
  driveHours: 1, driveMiles: 20,
  products: names.map(name => ({name, quantity: 1, unit: "each", notes: ""})),
  services: [], materials: []
});

test("draft preview renders real mixed IQ8 suggestion and generalized reason advisories without crashing", async () => {
  const draft = engine.generateQuoteDraft(request(["Enphase IQ8M Microinverter", "Enphase IQ Combiner 6C"]));
  assert.ok(draft.dependency_advisories.some(advisory => Array.isArray(advisory.suggestions)));
  assert.ok(draft.dependency_advisories.some(advisory => !advisory.suggestions && advisory.reason));
  const html = await renderPreview(draft);
  for (const advisory of draft.dependency_advisories) {
    if (advisory.suggestions) {
      for (const suggestion of advisory.suggestions) assert.ok(html.includes(suggestion.name || "IQ Disconnect Tool"));
    } else {
      assert.ok(html.includes(advisory.reason.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;")));
    }
  }
  assert.match(html, /Apply to Quote/);
});

test("draft preview renders generalized-only dependency advice and no-advisory drafts", async () => {
  const draft = engine.generateQuoteDraft(request(["Enphase IQ Combiner 6C"]));
  draft.dependency_advisories = draft.dependency_advisories.filter(advisory => !advisory.suggestions);
  assert.ok(draft.dependency_advisories.length > 0);
  assert.match(await renderPreview(draft), /Suggested accessories to review/);
  const ordinary = engine.generateQuoteDraft(request([]));
  assert.equal(ordinary.dependency_advisories.length, 0);
  assert.doesNotMatch(await renderPreview(ordinary), /Suggested accessories to review/);
});

test("automatic parser labor ranges use the engine's upper bound, never concatenated digits", () => {
  const parsed = parseQuoteRequestCase(`8/26 - PS: Quote Requests
Site ID: 100
Case Number: 001
Scope Description: Purchase new microinverters
Technician Count: 2
Estimated Onsite Labor Hours: 3-4
Estimated Total Labor Hours: 6-8
Products
Item Name: IQ8A
Quantity: 1-2`).request;
  const draft = engine.generateQuoteDraft(parsed);
  assert.equal(draft.labor_hours, 4);
  assert.equal(draft.fst_count, 2);
  assert.equal(draft.items[0].quantity, 2);
  assert.notEqual(draft.labor_hours, 34);
  const inactive = {...parsed, rmaRequired: "No", warrantyReplacements: [
    {name: "IQ8A", warrantyStatus: "Inactive", rmaRequired: "No"}
  ]};
  assert.ok(!engine.detectQuoteBlockingIssues(inactive).some(issue => issue.type === "enphase_microinverter_rma"));
  assert.ok(engine.detectQuoteBlockingIssues({...inactive, warrantyReplacements: [
    {name: "IQ8A", warrantyStatus: "Active", rmaRequired: "Yes"}
  ]}).some(issue => issue.type === "enphase_microinverter_rma"));
});

test("tile and quote review summaries render visible reasons and exact hygiene findings without hover", async () => {
  const {default: Summary} = await bundle(path.join("src", "components", "autoDrafter", "RequestReviewSummary.jsx"), {
    "lucide-react": {ChevronDown: () => null},
    "@/lib/utils": {cn: (...values) => values.filter(value => typeof value === "string").join(" ")}
  });
  const classification = suggestPanelRequestType("Panel RMA plus additional wiring required");
  const props = {
    classification,
    routingFlags: [{code: "test", label: "Review routing", reason: "Verify the requested device and warranty."}],
    hygiene: {author: "Synthetic Requester", flags: ["Missing or invalid quantity for Mounting and Electrical Hardware."]},
    sourceWarnings: ["Comment Site ID differs from the report."]
  };
  for (const compact of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(Summary, {...props, compact}));
    for (const value of ["Panel RMA + On-Demand", "Panel RMA identified", "Verify the requested device and warranty.",
      "Intake review: Synthetic Requester", "Mounting and Electrical Hardware.", "Comment Site ID differs"]) {
      assert.ok(html.includes(value), value);
    }
    assert.ok(!html.includes('title="Missing or invalid'));
    assert.match(html, /aria-label="Request review"/);
  }
});

test("compact issue expansion and unavailable Care are explicit; clear cases get no empty review box", async () => {
  const {default: Summary} = await bundle(path.join("src", "components", "autoDrafter", "RequestReviewSummary.jsx"), {
    "lucide-react": {ChevronDown: () => null},
    "@/lib/utils": {cn: (...values) => values.filter(value => typeof value === "string").join(" ")}
  });
  const html = renderToStaticMarkup(React.createElement(Summary, {
    compact: true, hygiene: {author: "Requester", flags: ["First issue", "Second issue", "Third issue"]},
    careError: new Error("unreachable"), onRetryCare() {}
  }));
  assert.match(html, /Show 1 more issue/);
  assert.match(html, /Third issue/);
  assert.match(html, /Could not verify Care subscriptions: unreachable/);
  assert.match(html, /Retry Care verification/);
  assert.equal(renderToStaticMarkup(React.createElement(Summary, {classification: {type: "no_panel"}})), "");
  const duplicate = renderToStaticMarkup(React.createElement(Summary, {
    compact: true,
    hygiene: {author: "Requester", flags: ["Site ID in the comment does not match the report row."]},
    sourceWarnings: ["Comment Site ID differs from the report. The report site ID was retained."]
  }));
  assert.match(duplicate, />1 flag</);
  assert.ok(!duplicate.includes("2 flags"));
});

test("descriptive $0 service lines stay out of line items and old unsent drafts are cleaned", async () => {
  const draft = engine.generateQuoteDraft({...request(["Enphase IQ8M Microinverter"]), quoteCategory: "Array Removal and Reinstallation",
    services: ["Array Removal and Reinstallation", "Electrical Correction", "Microinverter Replacement", "ATS Replacement"]
      .map(name => ({name, quantity: 1, unit: "each", notes: ""}))});
  assert.equal(draft.service_type, "Array Removal and Reinstallation");
  assert.ok(draft.items.length > 0);
  assert.ok(draft.items.every(item => item.unit_price > 0), JSON.stringify(draft.items.map(item => [item.name, item.unit_price])));
  const store = await bundle(path.join("src", "features", "autoDrafter", "autoDrafterDraftsStore.js"));
  const legacyItem = {name: "Electrical Correction", unit_price: 0, total: 0,
    confidence_reason: "Installation/service labor already covered by the FST's on-site labor hours -- shown at $0 by design, not a guess."};
  const priced = {name: "Part", unit_price: 10, total: 10};
  assert.deepEqual(store.withoutDescriptiveServiceItems({draft: {items: [legacyItem, priced]}}).draft.items, [priced]);
  const sent = {sentToQuotes: true, draft: {items: [legacyItem, priced]}};
  assert.equal(store.withoutDescriptiveServiceItems(sent), sent);
});

test("low-confidence items keep their O&M source line, and reviewer-taught swaps are reused by later drafts", async () => {
  const excerpt = await bundle(path.join("src", "features", "autoDrafter", "sourceLineExcerpt.js"));
  const odd = "Zorblax Mounting Widget";
  const before = engine.generateQuoteDraft(request([odd]));
  const unmatched = before.items.find(item => item.requested_name === odd);
  assert.equal(unmatched.confidence, "low");
  assert.equal(unmatched.source_line.name, odd);
  const comment = "O&M_QUOTE_REQUEST\nProducts\nItem Name: Zorblax Mounting Widget\nQuantity: 2\nNotes: north roof";
  const found = excerpt.findSourceExcerpt(comment, unmatched);
  assert.equal(found.lines[found.matchIndex], "Item Name: Zorblax Mounting Widget");
  assert.ok(found.lines.includes("Notes: north roof"));
  assert.equal(excerpt.findSourceExcerpt("nothing here", unmatched), null);
  // The bundled engine has its own learnedCorrections instance; teach it through its own module graph.
  const {build: esbuild} = await import("esbuild");
  const out = await esbuild({stdin: {contents: `export * from "./src/features/quoteDraftAgent/draftEngine.js"; export {setRuntimeLearnedCorrections} from "./src/features/quoteDraftAgent/learnedCorrections.js"; export {PRODUCT_CATALOG} from "./src/features/quoteDraftAgent/productCatalog.js";`, resolveDir: path.resolve("."), loader: "js"},
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", alias: {"@": path.resolve("src")}});
  const mod = {exports: {}};
  new Function("require", "module", "exports", out.outputFiles[0].text)(require, mod, mod.exports);
  const catalogName = mod.exports.PRODUCT_CATALOG.find(item => item.unit_price > 0 && item.category !== "Services").name;
  mod.exports.setRuntimeLearnedCorrections([{phrase: "  zorblax   MOUNTING widget ", catalogName}]);
  const after = mod.exports.generateQuoteDraft(request([odd]));
  const swapped = after.items.find(item => item.requested_name === odd);
  assert.equal(swapped.name, catalogName);
  assert.equal(swapped.confidence, "high");
  assert.match(swapped.confidence_reason, /saved correction/);
  mod.exports.setRuntimeLearnedCorrections([{phrase: odd, catalogName, is_deleted: true}]);
  assert.equal(mod.exports.generateQuoteDraft(request([odd])).items.find(item => item.requested_name === odd).confidence, "low");
});
