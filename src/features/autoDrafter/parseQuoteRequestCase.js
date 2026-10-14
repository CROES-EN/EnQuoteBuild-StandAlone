import {parseQuoteRequestOutput} from "../quoteDraftAgent/quoteRequestTextParser.js";
import {QUOTE_REQUEST_SECTION_HEADERS, quoteRequestCommentEvidence} from "../quoteRequestIntake/quoteRequestComment.js";
import {resolveRangeNumber} from "../quoteDraftAgent/rangeValues.js";

export const SECTION_HEADERS = QUOTE_REQUEST_SECTION_HEADERS.filter(section => section !== "Warranty Replacements");

// Keeps the raw field text ("30-45 minutes", "2 preferred (1 feasible)") so the draft engine's
// shared range rule (rangeValues.js) sees units and alternatives; only plain numbers become numbers.
function numberOrRange(value) {
  if (value === null || value === undefined || /^(?:unknown|none|n\/a|tbd)$/i.test(String(value).trim())) return undefined;
  const text = String(value).trim();
  if (/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(text)) return Number.parseFloat(text.replace(/,/g, ""));
  return resolveRangeNumber(text) === null ? undefined : text;
}

export function parseQuoteRequestCase(commentText) {
  const evidence = quoteRequestCommentEvidence(commentText);
  const warnings = [];
  if (!evidence.hasHeading) warnings.push("No recognized quote-request heading. Review the source comment before using this draft.");
  const parsed = evidence.normalized.trim() ? parseQuoteRequestOutput(evidence.normalized) : {
    products: [], materials: [], services: [], warrantyReplacements: []
  };
  const lines = new Set(evidence.normalized.split("\n").map(line => line.trim().toLowerCase()));
  if (!lines.has("site information")) warnings.push('No "Site Information" section found. Review site/case fields against the report.');
  if (!["products", "services", "additional materials", "warranty replacements"].some(section => lines.has(section))) {
    warnings.push("No line-item or warranty-replacement sections found. Review the scope before pricing.");
  }
  const optionNumbers = new Set([...evidence.normalized.matchAll(/\b(?:quote\s+)?option\s*([1-9])\b/gi)].map(match => match[1]));
  const multipleQuoteOptions = optionNumbers.size > 1 || /\b(?:separate|another|second)\s+quote\b/i.test(parsed.scopeDescription || "");
  if (multipleQuoteOptions) warnings.push("Multiple quote options requested. Separate alternatives before pricing; do not combine their quantities.");
  return {
    request: {
      ...parsed,
      technicianCount: numberOrRange(parsed.technicianCount),
      onsiteLaborHours: numberOrRange(parsed.onsiteLaborHours),
      totalLaborHours: numberOrRange(parsed.totalLaborHours),
      driveHours: numberOrRange(parsed.driveHours),
      driveMiles: numberOrRange(parsed.driveMiles),
      hasUnknownFields: parsed.hasUnknownFields || /\bUnknown\b/i.test(String(commentText || "")),
      multipleQuoteOptions
    },
    parseWarnings: warnings
  };
}
