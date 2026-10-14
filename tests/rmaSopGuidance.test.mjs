import test from "node:test";
import assert from "node:assert/strict";
import {selectRmaSops, suggestedRmaChecklist, buildRmaSubmissionText, manufacturerFormResources} from "../src/features/rma/rmaSopGuidance.js";
import {buildRmaRecord} from "../src/features/rma/rmaRecords.js";

const docs = [
  {id:"section", kind:"section", title:"Panel-Module RMA"},
  {id:"lg", title:"LG PANEL RMA", section_id:"section", content_html:"<p>Attach photos and serial numbers. No cloud links.</p>", updated_date:"2026-10-13"},
  {id:"steps", title:"Standard RMA Submission Steps", section_id:"section", content_html:"<p>Gather panel model and serial numbers.</p>"},
  {id:"suniva", title:"Suniva NO RMAs", section_id:"section", content_html:"No manufacturer RMA process."},
  {id:"micro", title:"Microinverter RMA", content_html:"Replace microinverter."},
  {id:"deleted", title:"Panel RMA", deleted:true},
  {id:"lg-copy", title:"LG PANEL RMA", section_id:"section", content_html:"<p>Attach photos and serial numbers. No cloud links.</p>", updated_date:"2026-10-12"},
  {id:"child", title:"Requirements", parent_id:"lg", content_html:"Meter readings."}
];

test("manufacturer resources use only matching manufacturer rows or specific SOPs", () => {
  const source = [{id:"dir",title:"Module Manufacturers Links",content_html:"directory"}];
  const resources = manufacturerFormResources(source,"LG",() => [
    {text:"LG claim form",links:[{text:"Claim",href:"https://lg.example/claim"}]},
    {text:"Solaria",links:[{text:"Other",href:"https://solaria.example/claim"}]},
    {text:"LG",links:[{text:"Unsafe",href:"javascript:alert(1)"},{text:"Credentials",href:"https://user:pass@lg.example"}]},
    {text:"LG",links:[{text:"Duplicate",href:"https://lg.example/claim"}]}
  ]);
  assert.equal(resources.length,1);
  assert.equal(resources[0].url,"https://lg.example/claim");
  assert.deepEqual(manufacturerFormResources(source,"",() => []),[]);
});

test("SOP guidance searches panel branches, ranks manufacturers, excludes deleted/unrelated pages and deduplicates identical imports", () => {
  const result = selectRmaSops(docs, "LG");
  assert.equal(result[0].id, "lg");
  assert.ok(result.some(doc => doc.id === "child"));
  assert.ok(result.some(doc => doc.id === "suniva"), "No-RMA warnings remain available");
  assert.ok(!result.some(doc => ["micro", "deleted", "lg-copy", "section"].includes(doc.id)));
  assert.deepEqual(selectRmaSops(docs, "", "no cloud").map(doc => doc.id), ["lg"]);
  assert.deepEqual(selectRmaSops(docs, "", "not present"), []);
  assert.deepEqual(selectRmaSops([{id:"loop",title:"Panel RMA",parent_id:"loop"}]).map(doc => doc.id), ["loop"]);
});

test("suggested checklist retains conditional instructions and never invents requirements", () => {
  assert.deepEqual(suggestedRmaChecklist(["Proof of purchase (if required)", "Proof of purchase (if required)",
    " Attach photos, no cloud links. ", "Overview", "x".repeat(501)]),
  ["Proof of purchase (if required)", "Attach photos, no cloud links."]);
});

test("copy-ready draft marks missing information, preserves manual submission and cites sources", () => {
  const preparation = {diagnosis:"Low output", checklist:{"Photos attached":true,"Proof of purchase (if required)":false}};
  const text = buildRmaSubmissionText({case_id:"123", panel_manufacturer:"LG"}, preparation, [docs[1]]);
  assert.match(text, /Subject: Panel RMA request - Case 123 - LG/);
  assert.match(text, /Serial numbers: \[NEEDS REVIEW\]/);
  assert.match(text, /\[Review needed\] Proof of purchase \(if required\)/);
  assert.match(text, /LG PANEL RMA \(updated 2026-10-13; lg\)/);
  assert.match(text, /files are not attached by EnQuote/);
  assert.match(text, /has not been submitted/);
});

test("RMA preparation persists through saves with validated checklist and source references", () => {
  const form = {case_id:"123",site_id:"456",panel_manufacturer:"LG",current_status:"New",
    submission_preparation:{diagnosis:" Low output ",checklist:{"Serial photo":true},
      sources:[{id:"lg",title:"LG PANEL RMA",updated_date:"2026-10-13"}]}};
  const saved = buildRmaRecord(form, null, "user@example.com");
  assert.equal(saved.submission_preparation.diagnosis,"Low output");
  assert.equal(saved.submission_preparation.checklist["Serial photo"],true);
  assert.equal(saved.submission_preparation.sources[0].id,"lg");
  assert.throws(() => buildRmaRecord({...form,submission_preparation:{checklist:{test:"yes"}}},null,"user@example.com"),/checklist/);
  assert.throws(() => buildRmaRecord({...form,submission_preparation:{sources:[null]}},null,"user@example.com"),/references/);
  assert.equal(buildRmaRecord({...form,submission_preparation:{manufacturer_form_url:"https://manufacturer.example/claim"}},null,"user@example.com")
    .submission_preparation.manufacturer_form_url,"https://manufacturer.example/claim");
  assert.throws(() => buildRmaRecord({...form,submission_preparation:{manufacturer_form_url:"javascript:alert(1)"}},null,"user@example.com"),/HTTPS/);
});
