const test = require("node:test");
const assert = require("node:assert/strict");
const {validateAnswers, visibleQuestions} = require("../shared/refundForm.cjs");

const answers = {
  cancellationTiming: "Immediately", refundChoice: "Partial refund",
  refundAmountRequested: "129.95", servicesCompleted: "No", customerEscalated: "No",
  siteId: "123", subscriptionId: "sub-1", customerName: "Customer",
  customerEmail: "customer@example.com", caseNumber: "456",
  refundReason: "Other", otherReason: "Billing issue", additionalNotes: "Details"
};

test("native refund amount accepts numeric input and preserves zero", () => {
  assert.equal(validateAnswers(answers).refundAmountRequested, 129.95);
  assert.equal(validateAnswers({...answers, refundAmountRequested: 0}).refundAmountRequested, 0);
  assert.equal(validateAnswers({...answers, refundAmountRequested: 100}).refundAmountRequested, 100);
});

test("native refund amount rejects missing, malformed and out-of-range amounts", () => {
  for (const value of [undefined, null, "", " ", true, [], {}, -1, "1.234", "1e2", "Infinity", NaN, 1_000_000_001]) {
    assert.equal(validateAnswers({...answers, refundAmountRequested: value}), null, String(value));
  }
});

test("no-refund submissions discard stale amount and services answers", () => {
  const values = {...answers, refundChoice: "No refund", refundAmountRequested: "invalid", servicesCompleted: "stale"};
  const validated = validateAnswers(values);
  assert.equal(validated.refundAmountRequested, null);
  assert.equal(validated.servicesCompleted, null);
  assert.ok(!visibleQuestions(values).some(question => ["refundAmountRequested", "servicesCompleted"].includes(question.key)));
});

test("refund amount appears only after selecting a refund and Other remains conditional", () => {
  assert.deepEqual(visibleQuestions({}).map(question => question.key), ["cancellationTiming", "refundChoice"]);
  assert.deepEqual(visibleQuestions({refundChoice: "Full refund"}).map(question => question.key),
    ["cancellationTiming", "refundChoice", "refundAmountRequested", "servicesCompleted"]);
  assert.ok(visibleQuestions(answers).some(question => question.key === "otherReason"));
  assert.ok(!visibleQuestions({...answers, refundReason: "Customer dissatisfaction"}).some(question => question.key === "otherReason"));
});
