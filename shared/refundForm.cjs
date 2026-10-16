const REASONS = [
  "Long wait for appointments",
  "Misinformation or inaccurate guidance (i.e. OOW system components)",
  "Issue or service not covered",
  "Service was not provided",
  "Repeated or unresolved issue",
  "Duplicate charge or billing error",
  "Customer dissatisfaction",
  "Other"
];
const QUESTIONS = [
  {key: "cancellationTiming", label: "When should the Enphase Care plan be canceled?", options: ["Immediately", "At the end of the current term"]},
  {key: "refundChoice", label: "Is a refund also being requested?", options: ["No refund", "Full refund", "Partial refund"]},
  {key: "refundAmountRequested", label: "Refund amount requested", type: "number", min: 0, maxValue: 1_000_000_000, step: "0.01"},
  {key: "servicesCompleted", label: "Were any Enphase Care services completed?", options: ["Yes", "No"]},
  {key: "customerEscalated", label: "Is the customer escalated?", options: ["Yes", "No"]},
  {key: "siteId", label: "Site ID", max: 200},
  {key: "subscriptionId", label: "Subscription ID", max: 200},
  {key: "customerName", label: "Customer name", max: 300},
  {key: "customerEmail", label: "Customer email address", type: "email", max: 254},
  {key: "caseNumber", label: "Case number", max: 200},
  {key: "refundReason", label: "Primary reason for the cancel and/or refund request", options: REASONS},
  {key: "otherReason", label: "Specify the cancellation/refund reason", type: "textarea", max: 4000},
  {key: "additionalNotes", label: "Detailed explanation of the refund request", type: "textarea", max: 4000,
    help: "Describe what happened, including relevant appointment, service, communication, or billing details."}
];

function visibleQuestions(values) {
  const questions = QUESTIONS.slice(0, 2);
  if (!QUESTIONS[1].options.includes(values.refundChoice)) return questions;
  if (values.refundChoice !== "No refund") {
    questions.push(QUESTIONS[2], QUESTIONS[3]);
    if (!QUESTIONS[3].options.includes(values.servicesCompleted)) return questions;
  }
  questions.push(...QUESTIONS.slice(4, 11));
  if (!REASONS.includes(values.refundReason)) return questions;
  if (values.refundReason === "Other") questions.push(QUESTIONS[11]);
  questions.push(QUESTIONS[12]);
  return questions;
}

function validateAnswers(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const answers = {};
  for (const question of QUESTIONS) {
    if (["servicesCompleted", "refundAmountRequested"].includes(question.key) && body.refundChoice === "No refund") {
      answers[question.key] = null;
      continue;
    }
    if (question.key === "otherReason" && body.refundReason !== "Other") {
      answers.otherReason = null;
      continue;
    }
    if (question.type === "number") {
      const raw = body[question.key];
      if (!["string", "number"].includes(typeof raw) ||
          !/^\d+(?:\.\d{1,2})?$/.test(String(raw).trim())) return null;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < question.min || amount > question.maxValue) return null;
      answers[question.key] = amount;
      continue;
    }
    const value = typeof body[question.key] === "string" ? body[question.key].trim() : "";
    if (!value || (question.options && !question.options.includes(value)) ||
        (question.max && value.length > question.max) ||
        (question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return null;
    answers[question.key] = value;
  }
  return answers;
}

module.exports = {QUESTIONS, REASONS, visibleQuestions, validateAnswers};
