/**
 * Persisted per-report-type column visibility for the Import Report dialog's "Map columns to
 * metrics" table.
 *
 * With every Supervisor Dashboard tab's fields now listed together (30+ across 7 groups - see
 * FIELD_DEFINITIONS), most imports only ever touch a handful of them, and clicking "Not in this
 * file" on every irrelevant dropdown each time gets old fast. This module lets a user hide the
 * fields they never use for a given report type - hidden fields are excluded from BOTH the
 * mapping table (so there's simply less to look at) and auto-mapping/aggregation (so the app
 * never spends time considering a column the user has said doesn't matter for this report),
 * directly matching the "so we don't stress the application by importing too much information"
 * goal. Hiding a field never deletes anything already imported - it only changes what a FUTURE
 * import of that report type offers to map, and can be undone at any time from the same panel.
 *
 * Stored per-machine in localStorage (matches this feature's existing local-only conventions -
 * see lastImportedFile.js) - this is a personal display preference, not shared/synced data.
 */

const STORAGE_KEY = "enquote_supervisor_import_column_prefs_v1";

// Row Identification (date/agent) fields drive date-grouping and per-agent breakdown for every
// report type - hiding them would break the import entirely, so they're never eligible to hide.
const ALWAYS_VISIBLE_GROUP = "Row Identification";

function readAllPrefs() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllPrefs(prefs) {
  try {
    globalThis.window?.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort only - the customization just won't persist this time.
  }
}

/** @returns {Set<string>} the set of FIELD_DEFINITIONS keys currently hidden for this source. */
export function getHiddenFieldKeys(source) {
  const prefs = readAllPrefs();
  const hidden = prefs[source]?.hiddenKeys;
  return new Set(Array.isArray(hidden) ? hidden : []);
}

/** Shows or hides one field for one report source; persists immediately. */
export function setFieldVisibility(source, fieldKey, visible) {
  const prefs = readAllPrefs();
  const hidden = new Set(prefs[source]?.hiddenKeys || []);
  if (visible) hidden.delete(fieldKey); else hidden.add(fieldKey);
  prefs[source] = { hiddenKeys: Array.from(hidden) };
  writeAllPrefs(prefs);
}

/** Restores every field to visible for one report source. */
export function resetFieldVisibility(source) {
  const prefs = readAllPrefs();
  delete prefs[source];
  writeAllPrefs(prefs);
}

/**
 * Filters FIELD_DEFINITIONS down to the ones a source should actually offer for mapping - every
 * Row Identification field always stays, everything else is excluded once hidden.
 */
export function getEffectiveFieldDefinitions(fieldDefinitions, source) {
  const hidden = getHiddenFieldKeys(source);
  if (hidden.size === 0) return fieldDefinitions;
  return fieldDefinitions.filter(field => field.group === ALWAYS_VISIBLE_GROUP || !hidden.has(field.key));
}
