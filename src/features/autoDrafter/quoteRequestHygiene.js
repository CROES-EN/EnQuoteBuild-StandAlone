import {parseQuoteRequestCase, SECTION_HEADERS} from "./parseQuoteRequestCase.js";
import {reviewCaseKey} from "./caseKey.js";
import {preferQuoteRequestComment, quoteRequestCommentEvidence} from "../quoteRequestIntake/quoteRequestComment.js";
import {resolveRangeValue} from "../quoteDraftAgent/rangeValues.js";

export const HYGIENE_VERIFICATION_NOTE = "Needs verification in Salesforce: supporting photos, actual agent usage, factual accuracy, measurements, and whether the comment author is the requesting FST. This report cannot prove those steps.";

export function quoteRequestReportColumns(columns) {
  const find = names => names.map(name => columns.find(column => column.trim().toLowerCase() === name)).find(Boolean);
  return {
    caseNumber: find(["case number"]),
    siteId: find(["enlighten site id", "site id"]),
    comment: find(["case comments", "case comment", "comment"]),
    author: find(["case comment created by", "case comment author"]),
    created: find(["case comment created date"]),
    omStatus: find(["o&m status"])
  };
}

export function assessQuoteRequestHygiene(row, columns) {
  const comment = String(row[columns.comment] || "");
  const status = String(row[columns.omStatus] || "").trim();
  const {request} = parseQuoteRequestCase(comment);
  const flags = [];
  const observations = [];
  if (!columns.comment) flags.push("Report is missing the Case Comment column.");
  else if (!comment.trim()) flags.push("Quote-request comment is empty.");
  const evidence = quoteRequestCommentEvidence(comment);
  if (!evidence.hasHeading) {
    flags.push("Recognized quote-request header is missing.");
  }
  const lines = new Set(evidence.normalized.split("\n").map(line => line.trim().toLowerCase()));
  const missingSections = SECTION_HEADERS.filter(section => !lines.has(section.toLowerCase()));
  if (missingSections.length) flags.push(`Standardized summary sections missing: ${missingSections.join(", ")}.`);
  for (const [field, label] of [
    ["siteId", "Site ID"], ["caseNumber", "Case Number"], ["customer", "Customer Name"],
    ["siteAddress", "Site Address"], ["problemDescription", "Problem Description"], ["scopeDescription", "Scope Description"]
  ]) {
    if (!request[field]) flags.push(`Missing or unresolved ${label} in the request summary.`);
  }
  for (const [field, column, label] of [["siteId", columns.siteId, "Site ID"], ["caseNumber", columns.caseNumber, "Case Number"]]) {
    if (request[field] && column && String(row[column] ?? "").trim() &&
        reviewCaseKey(request[field]) !== reviewCaseKey(row[column])) {
      flags.push(`${label} in the comment does not match the report row.`);
    }
  }
  const items = [...request.products, ...request.materials, ...request.services, ...request.warrantyReplacements];
  for (const item of items) {
    const quantity = String(item.quantity || "").trim().replace(/[\u2010-\u2015\u2212]/g, "-");
    if (!/^\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?(?:\s+[a-z].*)?$/i.test(quantity) || !(resolveRangeValue(quantity).value > 0)) {
      flags.push(`Missing or invalid quantity for ${item.name}.`);
    }
  }
  if (!columns.omStatus) flags.push("Report is missing O&M Status; status compliance cannot be checked.");
  else if (status !== "Quote Requested") {
    const progressed = /^(?:quote (?:draft|pending approval|approved|rejected|pending materials|pending payment|sent.*)|invoice.*|pending schedule|scheduled)$/i.test(status);
    const note = `Current O&M Status is ${status || "blank"}, not Quote Requested. ${progressed ? "Later workflow stage; this does not prove intake noncompliance." : "Verify whether the case legitimately progressed after intake."}`;
    if (progressed) observations.push(note); else flags.push(note);
  }
  return {
    flags, observations, request, verification: HYGIENE_VERIFICATION_NOTE,
    author: String(row[columns.author] || "").trim() || "Unknown comment author",
    caseNumber: String(row[columns.caseNumber] || "").trim(),
    siteId: String(row[columns.siteId] || "").trim(),
    comment, created: String(row[columns.created] || "").trim(), omStatus: status
  };
}

export function hygieneFlagCategory(flag) {
  return flag.includes("header is missing") ? "Missing quote-request header" :
    flag.includes("sections missing") ? "Missing summary sections" :
    flag.includes("quantity") ? "Missing / invalid item quantity" :
    flag.includes("does not match") ? "Wrong Case Number / Site ID" :
    flag.includes("Report is missing") ? "Missing report columns" :
    flag.includes("O&M Status") ? "Not in Quote Requested status" :
    "Missing site / customer / scope";
}

export function hygieneFlagCategories(flags) {
  return [...new Set((flags || []).map(hygieneFlagCategory))];
}

export function buildQuoteRequestHygieneReport(table) {
  const columns = quoteRequestReportColumns(table?.columns || []);
  const byCase = new Map();
  for (const [index, row] of (table?.rows || []).entries()) {
    const comment = String(row[columns.comment] || "");
    const status = String(row[columns.omStatus] || "");
    const evidence = quoteRequestCommentEvidence(comment);
    if (evidence.alternate) continue;
    const structured = evidence.hasRequest;
    const candidate = structured || /^quote\b/i.test(status.trim()) ||
      /\b(?:quote request|request(?:ing)? (?:a )?quote|on[ -]demand quote)\b/i.test(comment);
    if (!candidate) continue;
    const key = reviewCaseKey(row[columns.caseNumber]) || `missing-case-${index}`;
    const previous = byCase.get(key);
    if (!previous || preferQuoteRequestComment(comment, previous.row[columns.comment], row[columns.created], previous.row[columns.created])) {
      byCase.set(key, {row});
    }
  }
  const records = [...byCase.values()].map(({row}) => assessQuoteRequestHygiene(row, columns));
  const byAuthor = new Map();
  const issues = new Map();
  for (const record of records) {
    const key = record.author.toLowerCase();
    const summary = byAuthor.get(key) || {author: record.author, requests: 0, flagged: 0, issues: {}};
    summary.requests += 1;
    if (record.flags.length) summary.flagged += 1;
    byAuthor.set(key, summary);
    const categories = hygieneFlagCategories(record.flags);
    for (const category of categories) {
      issues.set(category, (issues.get(category) || 0) + 1);
      summary.issues[category] = (summary.issues[category] || 0) + 1;
    }
  }
  return {
    records, flagged: records.filter(record => record.flags.length),
    authors: [...byAuthor.values()].sort((a, b) => b.flagged - a.flagged || a.author.localeCompare(b.author)),
    issues: [...issues].map(([issue, cases]) => ({issue, cases})).sort((a, b) => b.cases - a.cases || a.issue.localeCompare(b.issue)),
    importedAt: table?.importedAt, sourceFileName: table?.sourceFileName
  };
}
