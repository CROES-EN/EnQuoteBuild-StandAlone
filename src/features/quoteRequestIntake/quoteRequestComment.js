export const QUOTE_REQUEST_SECTION_HEADERS = [
  "Site Information", "Findings", "Recommended Scope of Work", "Site Characteristics",
  "Access Requirements", "Labor", "Travel", "Products", "Services",
  "Additional Materials", "Technician Recommendations", "Warranty Replacements"
];

export function normalizeQuoteRequestComment(comment) {
  return String(comment || "").replace(/\u00a0/g, " ").split(/\r?\n/).map(line => {
    const clean = line.trim().replace(/\*\*/g, "")
      .replace(/^(?:[•◦▪‣?]|[-*]\s|\d+[.)]\s)\s*/, "")
      .replace(/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*-?\s*[A-Za-z][A-Za-z .]{0,30}:\s*/, "").trim();
    const heading = clean.replace(/:\s*$/, "");
    return QUOTE_REQUEST_SECTION_HEADERS.some(section => section.toLowerCase() === heading.toLowerCase()) ? heading : clean;
  }).join("\n");
}

// Fuzzy line-start heading: O&M_QUOTE, O&M_QUOTE_REQUEST and typed variants such as
// "O & M Quote Request", "OM-QUOTE", "O&amp;M_QUOTE_REQ", "[O&M_QUOTES]" or "Quote Request(s)".
const SEPARATOR = String.raw`[\s_\-.:/]*`;
export const QUOTE_REQUEST_HEADING = new RegExp(
  String.raw`^[\s#*_\[\](){}<>|~=:.\-]*(?:[O0]\s*(?:&amp;|&|and|n|\+|/)?\s*M${SEPARATOR}QUOTES?` +
  String.raw`(?:${SEPARATOR}REQ(?:UEST(?:ED|S)?)?)?|Quote${SEPARATOR}Requests?)(?![A-Za-z0-9])`, "im");

// O&M requests that are not quotes. The O&M prefix is required so ordinary lines such as
// "Return Reason:" or "Escalation Severity:" inside a comment never match.
export const ALTERNATE_REQUEST_TYPES = [
  {value: "care_cancellation", label: "Care Cancellation", heading: "O&M_CARE_CANCELLATION"},
  {value: "escalation", label: "Escalation", heading: "O&M_ESCALATION"},
  {value: "return", label: "Return", heading: "O&M_RETURN"}
];
const ALTERNATE_REQUEST_HEADING = new RegExp(
  String.raw`^[\s#*_\[\](){}<>|~=:.\-]*(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?[\s\-:]*)?[O0]\s*(?:&amp;|&|and|n|\+|/)?\s*M${SEPARATOR}` +
  String.raw`(?:(CARE${SEPARATOR}CANCEL+(?:L?ATIONS?|LED)?)|(ESCALAT(?:IONS?|ED|E))|(RETURNS?|RMA${SEPARATOR}RETURNS?))(?![A-Za-z0-9])`, "im");

export function alternateRequestType(comment) {
  const normalized = normalizeQuoteRequestComment(comment);
  const match = ALTERNATE_REQUEST_HEADING.exec(normalized);
  if (!match) return null;
  const quote = QUOTE_REQUEST_HEADING.exec(normalized);
  if (quote && quote.index < match.index) return null;
  return ALTERNATE_REQUEST_TYPES[match[1] ? 0 : match[2] ? 1 : 2];
}

export function quoteRequestCommentEvidence(comment) {
  const normalized = normalizeQuoteRequestComment(comment);
  const alternate = alternateRequestType(comment);
  const hasHeading = !alternate && QUOTE_REQUEST_HEADING.test(normalized);
  const hasStructuredFields = /^(?:Scope Description|Recommended Scope of Work|Scope of Work)\b/im.test(normalized) &&
    /^(?:Site ID|Case Number|Quote Category|Item Name|Service Name|Equipment)\s*:/im.test(normalized);
  const hasLaborMarker = /^Estimated Onsite Labor Hours\s*:/im.test(normalized);
  return {normalized, alternate, hasHeading, hasStructuredFields,
    hasRequest: !alternate && (hasHeading || hasStructuredFields || hasLaborMarker)};
}

export function preferQuoteRequestComment(comment, previousComment, created, previousCreated) {
  const strength = value => {
    const evidence = quoteRequestCommentEvidence(value);
    return evidence.hasRequest ? 1 : 0;
  };
  const difference = strength(comment) - strength(previousComment);
  if (difference) return difference > 0;
  const time = Date.parse(String(created || ""));
  const previousTime = Date.parse(String(previousCreated || ""));
  return Number.isFinite(time) && (!Number.isFinite(previousTime) || time > previousTime);
}
