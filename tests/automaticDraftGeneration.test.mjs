import test from "node:test";
import assert from "node:assert/strict";
import {prepareAutomaticDraft, runAutomaticDraftBatch} from "../src/features/autoDrafter/automaticDraftGeneration.js";

const candidate = (caseNumber = "001") => ({caseNumber, siteId: "100", comment: `O&M_QUOTE_REQUEST
Site Information
Case Number: ${caseNumber}
Site ID: 100
Recommended Scope of Work
Scope Description: Replace Enphase microinverters
Products
Item Name: IQ8A
Quantity: 1`});
function dependencies(overrides = {}) {
  const records = [];
  return {
    records, listSaved: async () => [],
    buildDraft: request => ({scope_of_work: request.scopeDescription, items: request.products}),
    createIfMissing: async (caseNumber, payload) => {
      const record = {id: caseNumber, caseNumber, ...payload}; records.push(record); return {record, created: true};
    },
    onSaved() {}, onProgress() {}, isCancelled: () => false, ...overrides
  };
}
test("automatic batches generate sequential review drafts, preserve saved work and do not send real quotes", async () => {
  let running = 0;
  let maxRunning = 0;
  const deps = dependencies({listSaved: async () => [{id: "002", draft: {edited: true}}]});
  const create = deps.createIfMissing;
  deps.createIfMissing = async (...args) => {
    running += 1; maxRunning = Math.max(maxRunning, running);
    await new Promise(resolve => setTimeout(resolve, 1));
    const result = await create(...args); running -= 1; return result;
  };
  const result = await runAutomaticDraftBatch([candidate("001"), candidate("002"), candidate("003")], deps);
  assert.equal(result.created, 2);
  assert.equal(maxRunning, 1);
  assert.deepEqual(deps.records.map(record => record.caseNumber), ["001", "003"]);
  assert.ok(deps.records.every(record => record.status === "ai_generated_quote_needs_review" && !record.sentToQuotes));
});
test("missing structure is skipped explicitly, and ID mismatches retain source IDs with warnings", async () => {
  assert.match(prepareAutomaticDraft({caseNumber: "1", comment: "Ordinary case note"}).skip, /No structured scope/);
  assert.match(prepareAutomaticDraft({caseNumber: "", comment: ""}).skip, /Missing case/);
  const prepared = prepareAutomaticDraft({...candidate(), siteId: "999", caseNumber: "different"});
  assert.equal(prepared.request.siteId, "999");
  assert.equal(prepared.request.caseNumber, "different");
  assert.equal(prepared.parseWarnings.filter(warning => warning.includes("differs")).length, 2);
});
test("per-case storage failures are surfaced without stopping unrelated requests", async () => {
  const deps = dependencies();
  const create = deps.createIfMissing;
  deps.createIfMissing = async (number, payload) => {
    if (number === "002") throw new Error("disk full");
    return create(number, payload);
  };
  const result = await runAutomaticDraftBatch([candidate("001"), candidate("002"), candidate("003")], deps);
  assert.equal(result.created, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /disk full/);
});
test("cancellation stops remaining drafts in the batch", async () => {
  let cancelled = false;
  const deps = dependencies({onSaved: () => {cancelled = true;}, isCancelled: () => cancelled});
  await runAutomaticDraftBatch([candidate("001"), candidate("002")], deps);
  assert.deepEqual(deps.records.map(record => record.caseNumber), ["001"]);
});
test("a draft saved concurrently is retained and not counted as newly generated", async () => {
  let observed;
  const record = {caseNumber: "001", draft: {edited: true}};
  const deps = dependencies({createIfMissing: async () => ({record, created: false}), onSaved: value => {observed = value;}});
  const result = await runAutomaticDraftBatch([candidate()], deps);
  assert.equal(result.created, 0);
  assert.equal(observed, record);
});
