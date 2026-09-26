/**
 * Per-report-type summary-field configuration for the Report Data Tables compact row view -
 * which columns show on each row (e.g. Case Number / Homeowner / Case Owner / O&M Status) and
 * what label each one displays (e.g. showing the "Contact Name" column labeled as "Homeowner").
 *
 * Deliberately separate from tableColumnPreferences.js, which only controls whether a column
 * participates in search/sort - this file controls the small, curated "at a glance" summary
 * shown on each compact row, independent of that broader show/hide list.
 *
 * Falls back to the report type's built-in default (passed in by the caller, defined in
 * ReportDataTablesPanel.jsx) until the user explicitly customizes it via "Configure Fields",
 * at which point the user's choice is saved and takes over for that report type going forward.
 *
 * FIX (per explicit request - "make sure any of the customizable settings are locked per
 * user"): this previously stored each report type's summary-field configuration under one key
 * shared by EVERYONE signed in on the same PC. Now uses userScopedStorage.js's scopedKey() to
 * namespace the key by the CURRENTLY SIGNED-IN user, so each person's configuration is fully
 * independent.
 *
 * v2 FIX: automatic migration of old, pre-fix shared values has been REMOVED (see
 * themeStore.js's v2 comment for the full explanation) - it was found to leak one person's
 * settings into another person's account the first time they signed in. Every user now starts
 * from the built-in default until they personally customize it via "Configure Fields".
 */

import {scopedKey} from "@/lib/userScopedStorage";

const STORAGE_KEY_PREFIX = "enquote_report_table_summary_fields_v1_";

/**
 * @param {string} reportType
 * @param {Array<{column: string, label: string}>} defaultFields - fallback used until the user
 *   customizes this report type
 * @returns {Array<{column: string, label: string}>}
 */
export function getSummaryFields(reportType, defaultFields) {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY_PREFIX + reportType));
    if (!raw) return defaultFields || [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (defaultFields || []);
  } catch {
    return defaultFields || [];
  }
}

export function setSummaryFields(reportType, fields) {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY_PREFIX + reportType), JSON.stringify(fields));
  } catch {
    // Ignore storage failures (e.g. private-browsing quota) - the in-memory selection made in
    // this session still works, it just won't persist across a restart.
  }
}

export function resetSummaryFields(reportType) {
  localStorage.removeItem(scopedKey(STORAGE_KEY_PREFIX + reportType));
}
