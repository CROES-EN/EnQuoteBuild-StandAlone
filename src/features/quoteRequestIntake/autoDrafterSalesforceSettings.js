/**
 * Stores the user's own Salesforce report URL for the Auto-Drafter tab's "Salesforce"
 * import button - EXACT mirror of workloadSalesforceSettings.js's proven pattern (per-user
 * via localStorage + scopedKey, sensible default, explicit reset function), but with its
 * own DISTINCT storage key and its own DISTINCT default URL.
 *
 * CRITICAL, CONFIRMED via reading the real workloadSalesforceSettings.js: that module's
 * storage key is a single hardcoded constant, NOT parameterized by report type. Reusing it
 * as-is for this second report would have caused a real, live bug - saving this report's URL
 * would silently overwrite (and be overwritten by) the Workload tab's saved URL for the same
 * signed-in user. This file exists specifically to avoid that collision - confirmed via a
 * standalone test (alongside the paired SalesforceImportButton.jsx patch) that the two
 * report types' saved URLs stay fully independent.
 */

import { scopedKey } from "@/lib/userScopedStorage";

const STORAGE_KEY = "enquote_autodrafter_salesforce_report_url";

/** The "Quote Request Cases with Case Comments" Salesforce report - confirmed real link
 *  from ReportInventory.jsx's own documented source-of-truth mapping ("New quote demand"). */
export const DEFAULT_SALESFORCE_REPORT_URL =
  "https://enphase.lightning.force.com/lightning/r/Report/00OPs000007cj89MAA/view?queryScope=userFolders";

export function getSalesforceReportUrl() {
  try {
    const saved = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // localStorage unavailable - fall through to the default below.
  }
  return DEFAULT_SALESFORCE_REPORT_URL;
}

export function setSalesforceReportUrl(url) {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), String(url || "").trim());
  } catch {
    // Ignore storage failures - in-memory behavior for the rest of this session still works.
  }
}

export function resetSalesforceReportUrl() {
  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY));
  } catch {
    // Ignore storage failures.
  }
}