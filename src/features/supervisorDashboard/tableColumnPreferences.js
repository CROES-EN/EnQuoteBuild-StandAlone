/**
 * Per-report-type column visibility for the Report Data Tables feature - which columns show
 * in the browsable grid. Deliberately separate from columnPreferences.js (which controls
 * IMPORT MAPPING field visibility against the fixed FIELD_DEFINITIONS list); this file instead
 * toggles visibility of whatever actual column headers exist in each imported spreadsheet,
 * since those headers are arbitrary per-file text (e.g. "Case #", "Severity"), not the app's
 * predefined metric keys.
 *
 * getHiddenColumns() now accepts an OPTIONAL `defaultHiddenColumns` list (per explicit
 * request: Care Subscriptions has 30+ real columns, but only 8 should be visible until a
 * user explicitly turns more on) - a genuinely new capability, since this file previously
 * only ever tracked columns a user explicitly hid, with everything else defaulting to
 * visible. The user's own choices ALWAYS win over this default in both directions: turning ON
 * a normally-hidden column, or turning OFF a normally-visible one, both persist exactly as
 * before. Report types that don't pass a defaultHiddenColumns list (Escalations, SFDC-Quotes,
 * etc.) are completely unaffected - they keep the original "everything visible until the user
 * hides something" behavior.
 *
 * FIX (per explicit request - "make sure any of the customizable settings are locked per
 * user"): this previously stored hidden/shown columns under keys shared by EVERYONE signed in
 * on the same PC. Now uses userScopedStorage.js's scopedKey() to namespace every key by the
 * CURRENTLY SIGNED-IN user, so each person's column choices are fully independent.
 *
 * v2 FIX: automatic migration of old, pre-fix shared values has been REMOVED (see
 * themeStore.js's v2 comment for the full explanation) - it was found to leak one person's
 * settings into another person's account the first time they signed in. Every user now
 * starts from the default (everything visible, or defaultHiddenColumns if provided) until
 * they personally customize it.
 */

import { scopedKey } from "@/lib/userScopedStorage";

const STORAGE_KEY_PREFIX = "enquote_report_table_hidden_columns_";
const STORAGE_KEY_SHOWN_PREFIX = "enquote_report_table_shown_columns_";

function readHidden(reportType) {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY_PREFIX + reportType));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function writeHidden(reportType, hiddenSet) {
  localStorage.setItem(scopedKey(STORAGE_KEY_PREFIX + reportType), JSON.stringify(Array.from(hiddenSet)));
}

// Tracks columns the user has explicitly turned ON, separately from "hidden" - needed so a
// column that's hidden BY DEFAULT (via defaultHiddenColumns) can be shown again, without this
// file needing to know which columns were ever part of some other list's default.
function readShown(reportType) {
  try {
    const raw = localStorage.getItem(scopedKey(STORAGE_KEY_SHOWN_PREFIX + reportType));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function writeShown(reportType, shownSet) {
  localStorage.setItem(scopedKey(STORAGE_KEY_SHOWN_PREFIX + reportType), JSON.stringify(Array.from(shownSet)));
}

/**
 * Returns a Set of column names currently hidden for this report type.
 * @param {string} reportType
 * @param {string[]} [defaultHiddenColumns] - columns to hide until the user explicitly shows
 *   them (e.g. Care Subscriptions' many rarely-needed columns) - omit for the original
 *   "everything visible by default" behavior.
 */
export function getHiddenColumns(reportType, defaultHiddenColumns) {
  const explicitlyHidden = readHidden(reportType);
  if (!defaultHiddenColumns || !defaultHiddenColumns.length) return explicitlyHidden;

  const explicitlyShown = readShown(reportType);
  const hidden = new Set(defaultHiddenColumns);
  explicitlyShown.forEach((col) => hidden.delete(col));
  explicitlyHidden.forEach((col) => hidden.add(col));
  return hidden;
}

export function setColumnVisibility(reportType, columnName, visible) {
  const hidden = readHidden(reportType);
  const shown = readShown(reportType);
  if (visible) {
    hidden.delete(columnName);
    shown.add(columnName);
  } else {
    hidden.add(columnName);
    shown.delete(columnName);
  }
  writeHidden(reportType, hidden);
  writeShown(reportType, shown);
  return hidden;
}

export function resetColumnVisibility(reportType) {
  localStorage.removeItem(scopedKey(STORAGE_KEY_PREFIX + reportType));
  localStorage.removeItem(scopedKey(STORAGE_KEY_SHOWN_PREFIX + reportType));
}
