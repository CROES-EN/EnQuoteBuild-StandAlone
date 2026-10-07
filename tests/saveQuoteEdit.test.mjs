import test from "node:test";
import assert from "node:assert/strict";
import {saveQuoteEdit} from "../src/features/quotes/saveQuoteEdit.js";

const user = {email: "editor@example.com"};
const data = {site_id: "1300", total: 1350, labor_hours: 8, scope_of_work: "Manual quote details"};

test("all draft statuses update in place with revision checks and without hiding the quote", async () => {
  for (const status of ["draft", "draft_without_internal", "draft_without_fst", "ai_generated_quote_needs_review", null]) {
    const quote = {id: "original", status, _rev: 4};
    const calls = [];
    const result = await saveQuoteEdit({
      quote, data, user,
      getQuotes: () => {throw new Error("Draft should not read versions");},
      createQuote: () => {throw new Error("Draft should not create a version");},
      updateQuote: async (...args) => {calls.push(args); return {...quote, ...data};}
    });
    assert.deepEqual(calls, [["original", data, 4]]);
    assert.equal(result.id, "original");
    assert.equal(result.total, 1350);
    assert.equal(result.status, status);
  }
});

test("failed replacement creation leaves original quote current", async () => {
  let retired = false;
  await assert.rejects(saveQuoteEdit({
    quote: {id: "original", status: "submitted", is_current_version: true}, data, user,
    getQuotes: async () => [],
    createQuote: async () => {throw new Error("disk full");},
    updateQuote: async () => {retired = true;}
  }), /disk full/);
  assert.equal(retired, false);
});

test("reviewed quote revisions persist manual details before retiring prior version", async () => {
  const calls = [];
  const quote = {id: "previous", parent_quote_id: "root", status: "approved", quote_number: "Q-1300", version_number: 2, _rev: 7};
  const result = await saveQuoteEdit({
    quote, data, user,
    getQuotes: async () => [{id: "root", version_number: 1}, quote, {id: "hidden", parent_quote_id: "root", version_number: 4, is_current_version: false}],
    createQuote: async payload => {calls.push(["create", payload]); return {...payload, id: "new"};},
    updateQuote: async (...args) => {calls.push(["update", ...args]);}
  });
  assert.equal(result.id, "new");
  assert.equal(result.total, 1350);
  assert.equal(result.status, "submitted");
  assert.equal(result.version_number, 5);
  assert.equal(result.parent_quote_id, "root");
  assert.equal(result.is_current_version, true);
  assert.equal(result.quote_number, "Q-1300");
  assert.deepEqual(calls[1], ["update", "previous", {is_current_version: false}, 7]);
  assert.equal(calls[0][0], "create");
});

test("retirement failure explicitly identifies saved replacement instead of losing it", async () => {
  await assert.rejects(saveQuoteEdit({
    quote: {id: "original", status: "rejected"}, data, user,
    getQuotes: async () => [],
    createQuote: async payload => ({...payload, id: "saved-replacement"}),
    updateQuote: async () => {throw new Error("CONFLICT: changed elsewhere");}
  }), /saved-replacement.*CONFLICT.*Both records remain available/);
});

test("draft conflicts retain concurrency protection", async () => {
  await assert.rejects(saveQuoteEdit({
    quote: {id: "original", status: "draft_without_internal", _rev: 2}, data, user,
    updateQuote: async () => {throw new Error("CONFLICT: changed elsewhere");}
  }), /CONFLICT/);
});
