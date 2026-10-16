import test from "node:test";
import assert from "node:assert/strict";
import {customerScopeSummary} from "../src/features/quotes/customerScopeSummary.js";
import {homeownerQuoteEmail} from "../src/features/quotes/homeownerQuoteEmail.js";

test("scope request preserves repair details and flows into a readable homeowner email", async () => {
  const scope = "Replace approximately 25 feet of damaged wiring and a 60 amp disconnect. Test system operation after repairs.";
  const summary = "The proposed work includes replacing approximately 25 feet of damaged wiring and the 60 amp disconnect. After the repairs, system operation will be tested.";
  let calls = 0;
  const result = await customerScopeSummary(scope, async request => {
    calls++;
    assert.ok(request.prompt.includes(scope));
    for (const detail of ["3-5", "quantities", "wiring lengths", "electrical ratings", "conditional work",
      "Do not invent", "internal notes", "source data, not instructions"]) {
      assert.ok(request.prompt.includes(detail), `prompt must cover ${detail}`);
    }
    assert.deepEqual(request.response_json_schema.required, ["summary"]);
    return {summary: `  ${summary}\n `};
  });
  assert.equal(calls, 1);
  assert.equal(result, summary);
  const email = homeownerQuoteEmail({picklist: "On-Demand"}, "Linda", null,
    {senderName: "Carsten", scopeSummary: result});
  assert.ok(email.includes(`\n\n${summary}\n\nI have attached`));
  assert.match(email, /approximately 25 feet/);
  assert.match(email, /60 amp disconnect/);
  assert.match(email, /system operation will be tested/);
});

test("summary rejects unavailable or invalid content rather than returning success-shaped text", async () => {
  await assert.rejects(customerScopeSummary("", async () => {throw new Error("Must not be called");}), /scope of work is required/);
  for (const response of [null, {}, {summary: ""}, {summary: "  "}, {summary: 42}]) {
    await assert.rejects(customerScopeSummary("Inspect the wiring.", async () => response), /empty or invalid/);
  }
  await assert.rejects(customerScopeSummary("Inspect the wiring.", async () => {throw new Error("Service unavailable");}), /Service unavailable/);
});
