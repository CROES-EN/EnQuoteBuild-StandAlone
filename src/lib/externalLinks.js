// Links from EnQuote to Salesforce cases and Enlighten sites. Pure helpers, no React, so they can
// be unit-tested and reused anywhere (quote PDFs deliberately do NOT use these).

export const SALESFORCE_ORIGIN = "https://enphase.lightning.force.com";
export const ENLIGHTEN_SITE_BASE = "https://enlighten.enphaseenergy.com/admin/sites/";

const clean = (value) => String(value ?? "").trim();
const columnKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9#]+/g, "");

/** Salesforce record ids are 15 or 18 letters/digits; Case ids start with "500". */
export function isSalesforceCaseId(value) {
  return /^500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(clean(value));
}

/** Lookup key for a case number: digits only, leading zeros dropped ("00123456" and "123456" match). */
export function caseNumberKey(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

/** Enlighten site ids are whole numbers. Anything else (blank, "N/A", subscription ids) isn't linked. */
export function normalizeSiteId(value) {
  const text = clean(value).replace(/,/g, "");
  if (/^\d+(\.0+)?$/.test(text)) return text.replace(/\.0+$/, "");
  return "";
}

export function isCaseNumberColumn(column) {
  return ["casenumber", "case#", "case"].includes(columnKey(column));
}

export function isEnlightenSiteIdColumn(column) {
  return ["enlightensiteid", "siteid", "siteid#", "enlightenid"].includes(columnKey(column));
}

export function caseIdFromRow(row) {
  if (!row || typeof row !== "object") return "";
  const entry = Object.entries(row).find(([column, value]) => columnKey(column) === "caseid" && isSalesforceCaseId(value));
  return entry ? clean(entry[1]) : "";
}

export function salesforceCaseUrl(caseId) {
  const id = clean(caseId);
  return isSalesforceCaseId(id) ? `${SALESFORCE_ORIGIN}/lightning/r/Case/${id}/view` : "";
}

/** Opens Salesforce's global search for a case number (used when we don't know the Case ID). */
export function salesforceCaseSearchUrl(caseNumber) {
  const term = clean(caseNumber);
  if (!term) return "";
  const state = {
    componentDef: "forceSearch:searchPageDesktop",
    attributes: { term, scopeMap: { type: "TOP_RESULTS" }, groupId: "DEFAULT" },
    state: {}
  };
  const json = JSON.stringify(state);
  const encoded = typeof btoa === "function"
    ? btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    : globalThis.Buffer.from(json, "utf8").toString("base64");
  return `${SALESFORCE_ORIGIN}/one/one.app#${encoded}`;
}

export function enlightenSiteUrl(siteId) {
  const id = normalizeSiteId(siteId);
  return id ? `${ENLIGHTEN_SITE_BASE}${id}` : "";
}

/** Builds a Map caseNumberKey -> Case ID from report rows that carry both columns. */
export function buildCaseIdIndex(rows, { numberColumn = "Case Number", idColumn = "Case ID" } = {}) {
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = caseNumberKey(row?.[numberColumn]);
    const id = clean(row?.[idColumn]);
    if (key && isSalesforceCaseId(id) && !index.has(key)) index.set(key, id);
  }
  return index;
}

/** Best link for a case number: the record page when the Case ID is known, otherwise a Salesforce search. */
export function caseLinkFor(caseNumber, { caseId, index } = {}) {
  const direct = salesforceCaseUrl(caseId) || salesforceCaseUrl(index?.get(caseNumberKey(caseNumber)));
  if (direct) return { url: direct, exact: true };
  const search = caseNumberKey(caseNumber) ? salesforceCaseSearchUrl(clean(caseNumber)) : "";
  return search ? { url: search, exact: false } : null;
}
