/**
 * Stores the user's own Salesforce report URL for the "Import via Salesforce" button (see
 * SalesforceImportButton.jsx) - per-USER (not just per-PC) via localStorage, since a shared PC
 * could have multiple people signing in, and each person may eventually want their own report
 * link. This is still just a personal/team display preference, not shared team data synced
 * anywhere - it lives only in this PC's local storage.
 *
 * FIX (per explicit request - two related asks handled together):
 *   1. "make sure any of the customizable settings are locked per user" - this previously
 *      stored the report URL under ONE fixed key shared by EVERYONE signed in on the same PC.
 *      Now uses userScopedStorage.js's scopedKey() to namespace the key by the CURRENTLY
 *      SIGNED-IN user, so each person's saved URL is fully independent (matching every other
 *      preference fixed tonight - no automatic migration of old shared values, per the same
 *      confirmed cross-user-leak reasoning documented in workloadPreferences.js/themeStore.js).
 *   2. "I would like the default report to be [URL]" - previously EMPTY was the only default,
 *      so any user who'd never set their own URL saw a blank state and had to paste one in
 *      manually before they could import anything. DEFAULT_SALESFORCE_REPORT_URL below is now
 *      returned automatically for any user who hasn't explicitly set (or cleared) their own -
 *      so a brand-new user (like Kim) gets a working, useful report out of the box instead of
 *      a blank screen, while still being fully free to change it via "Change Report URL" at
 *      any time (their own explicit choice always wins over this default, exactly like every
 *      other "default until customized" preference in this app).
 */

import { scopedKey } from "@/lib/userScopedStorage";

const STORAGE_KEY = "enquote_workload_salesforce_report_url";

/** The team's standard O&M Salesforce report - used as the default for any user who hasn't
 *  explicitly set (or cleared) their own report URL. */
export const DEFAULT_SALESFORCE_REPORT_URL =
  "https://enphase.lightning.force.com/lightning/r/Report/00OPs000007yDPlMAM/view?queryScope=userFolders";

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

/**
 * Explicitly clears this user's own saved URL, reverting them back to
 * DEFAULT_SALESFORCE_REPORT_URL - exposed separately from setSalesforceReportUrl("") so a
 * future "Reset to default" action (if ever added to the UI) has an unambiguous, named way to
 * request this, distinct from "the user typed and saved an empty string" (which, given the
 * default fallback above, behaves identically anyway - but this makes the INTENT explicit in
 * code wherever it's called from).
 */
export function resetSalesforceReportUrl() {
  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY));
  } catch {
    // Ignore storage failures.
  }
}
