// parseQuoteRequestCase.js
//
// Parses the free-text "O&M_QUOTE_REQUEST" case comment (as imported into the
// Auto-Drafter tab from the "Quote Request Cases with Case Comments" Salesforce
// report) into the exact request-object shape src/features/quoteDraftAgent/
// draftEngine.js's generateQuoteDraft() expects.
//
// CONFIRMED REAL FORMAT (from a live imported case, checked directly in DevTools
// before writing this parser -- not guessed): the comment is genuine multi-line
// text with one labeled field per line, grouped under standalone section header
// lines, e.g.:
//
//   O&M_QUOTE_REQUEST
//
//   Quote Category: Other
//   RMA Required: Unknown
//
//   Site Information
//
//   Site ID: 4326144
//   Case Number: 20436580
//   Customer Name: Veronica Sargeant
//   Site Address: 6123 Cody Trail, Tallahassee, FL 32311
//
//   Findings
//
//   Problem Description: ...
//   Root Cause: ...
//   Diagnostic Findings: ...
//
//   ... (Recommended Scope of Work, Site Characteristics, Access Requirements,
//        Labor, Travel, Products, Services, Additional Materials,
//        Technician Recommendations)
//
// Deliberately conservative, matching every other parsing utility in this
// codebase (extractField() in AutoDrafterCaseTile.jsx, matchLineItem() in
// draftEngine.js): a missing/unparseable field is left undefined/empty rather
// than guessed, and "Unknown"/"None" values are treated as no data rather than
// passed through as literal strings. This function NEVER throws -- a comment
// that doesn't match the expected structure simply yields an object with fewer
// fields populated (and a `parseWarnings` list explaining what was missing),
// not an error.

// Section headers, in the order they appear in a real export. Recognized as a
// section boundary only when a line is an EXACT (case-insensitive) match to one
// of these -- never a substring match -- so a field value that happens to
// contain one of these phrases can never be mistaken for a new section.
const SECTION_HEADERS = [
  "Site Information",
  "Findings",
  "Recommended Scope of Work",
  "Site Characteristics",
  "Access Requirements",
  "Labor",
  "Travel",
  "Products",
  "Services",
  "Additional Materials",
  "Technician Recommendations"
];

const SECTION_HEADER_SET = new Set(SECTION_HEADERS.map((s) => s.toLowerCase()));

// Values the source export uses to mean "no data" -- never treated as real
// values, matching the exact convention already used by matchLineItem() /
// normalizeQuantity() in draftEngine.js (which special-case "Unknown" the same
// way).
function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  return /^(unknown|none|n\/a|none identified)$/i.test(trimmed);
}

// Parses a single "Label: value" line. Returns null if the line doesn't match
// that shape (e.g. it's a section header or a blank line) -- callers rely on
// this to distinguish real fields from structural lines.
function parseLabeledLine(line) {
  const match = line.match(/^([A-Za-z][A-Za-z0-9 /&']*?):\s*(.*)$/);
  if (!match) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function toNumberOrUndefined(value) {
  if (isEmptyValue(value)) return undefined;
  const num = parseFloat(String(value).replace(/[^\d.]/g, ""));
  return isNaN(num) ? undefined : num;
}

function cleanOrUndefined(value) {
  return isEmptyValue(value) ? undefined : String(value).trim();
}

// Splits a section's raw lines into repeating item entries, one per
// occurrence of `startLabel` (e.g. "Item Name" or "Service Name"). Each entry
// collects every "Label: value" line up to (but not including) the next
// occurrence of `startLabel`. An entry whose start-label value is empty/"None"
// is dropped entirely -- this is what correctly excludes the very common
// "Item Name: None" placeholder row seen in Additional Materials when nothing
// was needed, without needing a special case for it.
function splitRepeatingEntries(sectionLines, startLabel) {
  const entries = [];
  let current = null;

  for (const rawLine of sectionLines) {
    const parsed = parseLabeledLine(rawLine);
    if (!parsed) continue;

    if (parsed.label.toLowerCase() === startLabel.toLowerCase()) {
      current = { name: parsed.value };
      entries.push(current);
      continue;
    }
    if (!current) continue; // stray field before any start-label seen -- ignore, don't guess

    const key = parsed.label.toLowerCase();
    if (key === "quantity") current.quantity = parsed.value;
    else if (key === "unit") current.unit = parsed.value;
    else if (key === "notes") current.notes = parsed.value;
  }

  return entries
    .filter((entry) => !isEmptyValue(entry.name))
    .map((entry) => ({
      name: entry.name,
      quantity: cleanOrUndefined(entry.quantity),
      unit: cleanOrUndefined(entry.unit),
      notes: cleanOrUndefined(entry.notes)
    }));
}

/**
 * Parses a raw Auto-Drafter case comment string into the request-object shape
 * generateQuoteDraft() (draftEngine.js) expects.
 *
 * Returns:
 *   {
 *     request: { siteId, caseNumber, customer, siteAddress, problemDescription,
 *                rootCause, diagnosticFindings, scopeDescription,
 *                technicianCount, onsiteLaborHours, totalLaborHours,
 *                driveHours, driveMiles, products, materials, services,
 *                hasUnknownFields },
 *     parseWarnings: string[]   // human-readable notes on anything not found
 *   }
 *
 * Never throws -- a comment that doesn't look like a real O&M_QUOTE_REQUEST at
 * all still returns a (mostly empty) request object plus a warning, so the
 * caller can decide whether to still attempt a draft or block with a clear
 * message instead.
 */
export function parseQuoteRequestCase(commentText) {
  const warnings = [];
  const text = String(commentText || "");

  if (!/O&M_QUOTE_REQUEST/i.test(text)) {
    warnings.push('This case comment does not contain the expected "O&M_QUOTE_REQUEST" marker -- parsing may be incomplete or unreliable.');
  }

  // FIX (confirmed real bug via a live case screenshot -- Case 20384767, Site 6382013):
  // a case comment using bullet-point formatting (e.g. "• Quote Category:
  // Microinverter Replacement" instead of plain "Quote Category: Microinverter
  // Replacement") produced a COMPLETELY EMPTY draft. Root cause: parseLabeledLine()'s
  // regex requires a line to start with a plain letter, and the section-header check
  // requires an EXACT string match -- both silently fail on a leading bullet character,
  // discarding the field/header entirely rather than erroring. stripLeadingBullet()
  // removes a leading bullet/list-marker (•, ◦, ▪, ‣, -, *, or a numbered "1."/"1)"
  // marker) before any other processing, so both checks work correctly regardless of
  // whether the source export used bullets. Verified against the real bulleted case
  // text end-to-end (Site ID, Case Number, Customer, Address, Scope Description,
  // Products, and Services all now extract correctly) and confirmed every existing,
  // already-tested PLAIN (unbulleted) case is byte-for-byte unaffected by this change.
  function stripLeadingBullet(line) {
    // FIX (confirmed real follow-up bug, Case 20384767): this case's REAL stored bullet
    // character is a literal "?" (U+003F), not "•" (U+2022) -- even though it visually
    // DISPLAYS as "•" in Salesforce's own UI. This is a real mojibake artifact from the
    // Salesforce export pipeline (confirmed via direct inspection of the raw stored data),
    // not a typo or a different genuine bullet style. "?" is now included in the
    // bullet-character class alongside the original Unicode bullets.
    return line.replace(/^[\s]*(?:[•◦▪‣?]|[-*]\s|\d+[.)]\s)\s*/, "");
  }

  const lines = text.split(/\r?\n/).map((l) => stripLeadingBullet(l.trim()));

  // Group lines by section. Everything before the first recognized section
  // header is treated as "top-level" (Quote Category, RMA Required).
  const sections = { __top__: [] };
  let currentSection = "__top__";
  for (const line of lines) {
    if (!line) continue;
    if (SECTION_HEADER_SET.has(line.toLowerCase())) {
      const canonical = SECTION_HEADERS.find((s) => s.toLowerCase() === line.toLowerCase());
      currentSection = canonical;
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }
    if (!sections[currentSection]) sections[currentSection] = [];
    sections[currentSection].push(line);
  }

  // Simple single-value sections: build a { label(lowercased): value } map.
  function fieldMap(sectionName) {
    const map = {};
    for (const line of sections[sectionName] || []) {
      const parsed = parseLabeledLine(line);
      if (parsed) map[parsed.label.toLowerCase()] = parsed.value;
    }
    return map;
  }

  const topFields = fieldMap("__top__");
  const siteInfo = fieldMap("Site Information");
  const findings = fieldMap("Findings");
  const scopeFields = fieldMap("Recommended Scope of Work");
  const labor = fieldMap("Labor");
  const travel = fieldMap("Travel");

  if (!sections["Site Information"]) warnings.push('No "Site Information" section found -- site ID, case number, customer, and address could not be extracted.');
  if (!sections["Products"] && !sections["Services"] && !sections["Additional Materials"]) {
    warnings.push('No "Products", "Services", or "Additional Materials" sections found -- this draft will have no line items.');
  }

  const products = splitRepeatingEntries(sections["Products"] || [], "Item Name");
  const materials = splitRepeatingEntries(sections["Additional Materials"] || [], "Item Name");
  const services = splitRepeatingEntries(sections["Services"] || [], "Service Name");

  // A simple, honest "were there unresolved unknowns" signal, mirroring the
  // same "Unknown" convention used throughout this source data -- used by
  // generateRiskStatement()'s hasUnknowns flag, not invented for this parser.
  const hasUnknownFields = /\bUnknown\b/i.test(text);

  const request = {
    quoteCategory: cleanOrUndefined(topFields["quote category"]),
    rmaRequired: cleanOrUndefined(topFields["rma required"]),

    siteId: cleanOrUndefined(siteInfo["site id"]),
    caseNumber: cleanOrUndefined(siteInfo["case number"]),
    customer: cleanOrUndefined(siteInfo["customer name"]),
    siteAddress: cleanOrUndefined(siteInfo["site address"]),

    problemDescription: cleanOrUndefined(findings["problem description"]),
    rootCause: cleanOrUndefined(findings["root cause"]),
    diagnosticFindings: cleanOrUndefined(findings["diagnostic findings"]),

    scopeDescription: cleanOrUndefined(scopeFields["scope description"]),

    technicianCount: toNumberOrUndefined(labor["technician count"]),
    onsiteLaborHours: toNumberOrUndefined(labor["estimated onsite labor hours"]),
    totalLaborHours: toNumberOrUndefined(labor["estimated total labor hours"]),

    driveHours: toNumberOrUndefined(travel["total drive hours"]),
    driveMiles: toNumberOrUndefined(travel["total drive miles"]),

    products,
    materials,
    services,

    hasUnknownFields
  };

  return { request, parseWarnings: warnings };
}
