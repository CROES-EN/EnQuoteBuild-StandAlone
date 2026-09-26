/**
 * Fully user-customizable preferences for the Workload page - per-user/per-PC via
 * localStorage (never synced anywhere - these are personal display/workflow preferences,
 * not shared team data), matching the same storage pattern already used by
 * tableColumnPreferences.js and workloadGoal.js elsewhere in this app.
 *
 * FIX (per explicit request - "make sure any of the customizable settings are locked per
 * user"): every preference in this file previously lived under ONE fixed key shared by
 * EVERYONE signed in on the same PC - tiles, column order/visibility, default sort, density,
 * management review names, "My Name" (Case Owner), and even the per-case "seen" notification
 * tracking. Every key below now goes through userScopedStorage.js's scopedKey(), which
 * namespaces it by the CURRENTLY SIGNED-IN user, so each person's entire set of Workload
 * preferences is fully independent.
 *
 * v2 FIX (CONFIRMED BUG, found via live testing): the first version of this fix ALSO
 * auto-migrated old, pre-fix shared values forward into any new user's scoped slot the first
 * time each was read. This caused a real, observed bug: signing in as a second person (Kim)
 * on the same PC caused her to silently inherit the FIRST person's (Carsten's) "My Name"
 * value - so Workload's "My Cases" view showed CARSTEN's cases while Kim was signed in, since
 * her own MY_NAME_KEY had been auto-populated with his name instead of being correctly empty
 * (which would have triggered the real auto-resolve-from-signed-in-user logic in
 * WorkloadReportTable.jsx). Automatic migration has been removed ENTIRELY from every function
 * in this file - every user now correctly starts from each preference's true default (no
 * tiles customized, no name set, default sort/density, etc.) until they personally set their
 * own value, with zero risk of inheriting a different person's prior configuration or
 * identity. The one-time cost: anyone who had already customized tiles/goal/etc. before this
 * fix shipped will need to redo that customization once - a small, one-time price for
 * eliminating a real identity-leak bug that showed one person's data to another.
 *
 * Covers everything requested:
 *   - Tiles ("buttons"): each tile has an editable label (text), icon (emoji), color, and a
 *     LIST of O&M Status values that map to it - this is the "change the text and/or the
 *     mapping for the buttons" request. A status counts as "important" (row emphasis, pinned
 *     sort, Review Me filter) if it's mapped to ANY tile - there's no longer a separate
 *     hardcoded "important" list; the tiles themselves ARE the definition.
 *   - Column visibility + display order (simple up/down reordering, not full drag-and-drop -
 *     kept intentionally simple to avoid adding a new drag-and-drop dependency for one
 *     feature; can be revisited if that's ever wanted).
 *   - Default sort column.
 *   - Row density (compact/comfortable).
 *
 * All colors use semi-transparent alpha overlays (bg-*-500/10 etc.), never solid pastel
 * backgrounds - deliberately, so any color choice here renders correctly across every theme
 * (Light+, Dark+, Monokai, Solarized) rather than only looking right in Light+, which was the
 * root cause of a full session's worth of bugs fixed earlier tonight.
 */

import {scopedKey} from "@/lib/userScopedStorage";

const TILES_KEY = "enquote_workload_tiles_v1";
const COLUMN_ORDER_KEY = "enquote_workload_column_order_v1";
const COLUMN_HIDDEN_KEY = "enquote_workload_column_hidden_v1";
const SORT_KEY = "enquote_workload_default_sort_v1";
const DENSITY_KEY = "enquote_workload_density_v1";

/**
 * Available tile colors - each resolves to a full, theme-safe class set (badge bg/text/dot,
 * row border/tint, active-tile ring). Users pick from this fixed palette rather than a raw
 * color input, so every choice is guaranteed to already be theme-safe.
 */
// IMPORTANT: this uses `colorLabel`, NOT `label` - a tile object ALSO has its own `label`
// field (the user's custom tile text, e.g. "Escalations"). An earlier version of this file
// used `label` here too, and since withResolvedColor() spreads this color object onto the
// tile, the color's `label` ("Red"/"Yellow"/etc.) silently overwrote the tile's real,
// user-set label on every read - which is exactly why customized tile names appeared to
// "not save" (they DID save correctly; this read-time merge was clobbering them on display).
// Keeping this field named differently from tile.label prevents that collision permanently.
export const TILE_COLOR_OPTIONS = [
  { key: "red", colorLabel: "Red", bg: "bg-red-500/10", text: "text-red-700", dot: "bg-red-600", border: "border-l-4 border-red-500", tint: "bg-red-500/5", ring: "ring-red-400" },
  { key: "yellow", colorLabel: "Yellow", bg: "bg-yellow-500/10", text: "text-yellow-700", dot: "bg-yellow-500", border: "border-l-4 border-yellow-500", tint: "bg-yellow-500/5", ring: "ring-yellow-400" },
  { key: "amber", colorLabel: "Amber", bg: "bg-amber-500/10", text: "text-amber-700", dot: "bg-amber-600", border: "border-l-4 border-amber-500", tint: "bg-amber-500/5", ring: "ring-amber-400" },
  { key: "orange", colorLabel: "Orange", bg: "bg-orange-500/10", text: "text-orange-700", dot: "bg-orange-600", border: "border-l-4 border-orange-500", tint: "bg-orange-500/5", ring: "ring-orange-400" },
  { key: "purple", colorLabel: "Purple", bg: "bg-purple-500/10", text: "text-purple-700", dot: "bg-purple-600", border: "border-l-4 border-purple-500", tint: "bg-purple-500/5", ring: "ring-purple-400" },
  { key: "blue", colorLabel: "Blue", bg: "bg-blue-500/10", text: "text-blue-700", dot: "bg-blue-600", border: "border-l-4 border-blue-500", tint: "bg-blue-500/5", ring: "ring-blue-400" },
  { key: "teal", colorLabel: "Teal", bg: "bg-teal-500/10", text: "text-teal-700", dot: "bg-teal-600", border: "border-l-4 border-teal-500", tint: "bg-teal-500/5", ring: "ring-teal-400" },
  { key: "emerald", colorLabel: "Green", bg: "bg-emerald-500/10", text: "text-emerald-700", dot: "bg-emerald-600", border: "border-l-4border-emerald-500", tint: "bg-emerald-500/5", ring: "ring-emerald-400" }
];

function resolveColor(colorKey) {
  return TILE_COLOR_OPTIONS.find((c) => c.key === colorKey) || TILE_COLOR_OPTIONS[0];
}

// Default tile set - matches the user's own chosen labels ("Escalations", not "Escalated")
// and emoji. The Needs Review icon (eyes) was confirmed directly from the user's screenshot;
// the other two icons are best-effort placeholders - now trivially correctable BY THE USER
// directly in the Customize panel itself (no code change needed), since full tile editing
// already exists.
const DEFAULT_TILES_RAW = [
  { id: "escalated", label: "Escalations", icon: "🚨", colorKey: "red", statusValues: ["Escalated"] },
  { id: "needs_review", label: "Needs Review", icon: "👀", colorKey: "yellow", statusValues: ["Needs Review"] },
  { id: "updated_by_client", label: "Updated by Client", icon: "👍", colorKey: "amber", statusValues: ["Updated by Client"] }
];

// Fingerprints of PRIOR default tile sets that were never customized by a real user - used
// ONLY to silently, safely upgrade someone still sitting on an old, untouched default to the
// CURRENT default set the next time getTiles() is called. If a user has changed ANYTHING
// about these tiles (label, icon, color, or status mapping), the stored fingerprint will no
// longer match any entry here, and their customization is left completely alone - this
// deliberately does NOT try to guess-and-fix typos or other deliberate edits (e.g. "Update by
// Client" instead of "Updated by Client" is NOT a recognized old default, so it is correctly
// treated as a real customization, not silently overwritten).
function tileFingerprint(tiles) {
  return JSON.stringify((tiles || []).map(({ id, label, icon, colorKey, statusValues }) => ({ id, label, icon, colorKey, statusValues })));
}
const KNOWN_OLD_DEFAULT_FINGERPRINTS = [
  // The very first default set, from before "Escalations"/emoji-confirmation existed.
  JSON.stringify([
    { id: "escalated", label: "Escalated", icon: "🔥", colorKey: "red", statusValues: ["Escalated"] },
    { id: "needs_review", label: "Needs Review", icon: "👀", colorKey: "yellow", statusValues: ["Needs Review"] },
    { id: "updated_by_client", label: "Updated by Client", icon: "\u2709\uFE0F", colorKey: "amber", statusValues: ["Updated by Client"] }
  ])
];

function withResolvedColor(tile) {
  return { ...tile, ...resolveColor(tile.colorKey) };
}

/** Returns the user's current tiles (label/icon/color/mapped statuses), each with its color
 *  classes already resolved - falls back to the current default 3 tiles if never customized,
 *  and safely auto-upgrades a genuinely untouched OLD default set to the current one (see
 *  KNOW_OLD_DEFAULT_FINGERPRINTS above). */
export function getTiles() {
  try {
    const raw = localStorage.getItem(scopedKey(TILES_KEY));
    if (!raw) return DEFAULT_TILES_RAW.map(withResolvedColor);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TILES_RAW.map(withResolvedColor);
    if (KNOWN_OLD_DEFAULT_FINGERPRINTS.includes(tileFingerprint(parsed))) {
      setTiles(DEFAULT_TILES_RAW);
      return DEFAULT_TILES_RAW.map(withResolvedColor);
    }
    return parsed.map(withResolvedColor);
  } catch {
    return DEFAULT_TILES_RAW.map(withResolvedColor);
  }
}

/** Saves the user's tiles - only the raw editable fields are persisted (resolved color classes
 *  are recomputed on read, so changing TILE_COLOR_OPTIONS later would apply retroactively). */
export function setTiles(tiles) {
  try {
    const toSave = (tiles || []).map(({ id, label, icon, colorKey, statusValues }) => ({
      id, label: label || "Untitled", icon: icon || "\u2b50", colorKey: colorKey || "red", statusValues: statusValues || []
    }));
    localStorage.setItem(scopedKey(TILES_KEY), JSON.stringify(toSave));
  } catch {
    // Ignore storage failures - in-memory state still works this session.
  }
}

export function resetTiles() {
  try { localStorage.removeItem(scopedKey(TILES_KEY)); } catch { /* ignore */ }
}

/** Returns the tile that a given O&M Status value maps to, or null if unmapped. */
export function getTileForStatus(value, tiles) {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  const list = tiles || getTiles();
  return list.find((t) => (t.statusValues || []).some((sv) => String(sv).trim().toLowerCase() === key)) || null;
}

/**
 * Checks a Workload row against every tile, trying "O&M Status" FIRST, then falling back to
 * the row's separate "Status" field if O&M Status didn't match anything - per explicit
 * confirmation this Salesforce export has TWO distinct status fields (a generic case-workflow
 * "Status" and a more granular "O&M Status"), and an important value can legitimately live in
 * either one depending on the case. This is now the correct function for ALL tile
 * matching/counting/filtering/sorting/highlighting logic - getTileForStatus() itself is left
 * unchanged and still used standalone where only a single, specific value needs checking (e.g.
 * the O&M Status badge's own color, which deliberately stays tied to its own literal value only).
 */
export function getTileForRow(row, tiles) {
  return getTileForStatus(row?.["O&M Status"], tiles) || getTileForStatus(row?.["Status"], tiles);
}

/** True if this status is mapped to ANY tile - this IS the definition of "important" now. */
export function isImportantOMStatus(value, tiles) {
  return Boolean(getTileForStatus(value, tiles));
}

/** Returns { border, tint } row-emphasis classes for an important status, or null otherwise. */
export function getImportantRowEmphasis(value, tiles) {
  const tile = getTileForStatus(value, tiles);
  return tile ? { border: tile.border, tint: tile.tint } : null;
}

// ---------------------------------------------------------------------------------------------
// Column visibility + order
// ---------------------------------------------------------------------------------------------

/** Master list of the 16 real imported columns (excludes the always-shown "Open" and "Details"
 *  columns, which aren't real imported data), in the ORIGINAL Excel-matching default order. */
export const DEFAULT_COLUMN_ORDER = [
  "O&M Status", "Project Picklist", "Status", "Case Number", "Enlighten Site ID",
  "Case Owner", "Subject", "Case Last Modified By", "Contact Name", "Contact: Email",
  "New_Location", "Contact: Phone", "Date/Time Opened", "Age (Days)",
  "Case Date/Time Last Modified", "Case ID"
];

/** Returns the user's saved column order, safely merged with DEFAULT_COLUMN_ORDER so a newly
 *  added column (from a future code change) still appears even if it predates the saved order. */
export function getColumnOrder() {
  try {
    const raw = localStorage.getItem(scopedKey(COLUMN_ORDER_KEY));
    if (!raw) return [...DEFAULT_COLUMN_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [...DEFAULT_COLUMN_ORDER];
    const known = parsed.filter((c) => DEFAULT_COLUMN_ORDER.includes(c));
    const missing = DEFAULT_COLUMN_ORDER.filter((c) => !known.includes(c));
    return [...known, ...missing];
  } catch {
    return [...DEFAULT_COLUMN_ORDER];
  }
}

export function setColumnOrder(order) {
  try { localStorage.setItem(scopedKey(COLUMN_ORDER_KEY), JSON.stringify(order)); } catch { /* ignore */ }
}

export function resetColumnOrder() {
  try { localStorage.removeItem(scopedKey(COLUMN_ORDER_KEY)); } catch { /* ignore */ }
}

/** Returns a Set of column names currently hidden by the user. Empty by default (everything visible). */
export function getHiddenWorkloadColumns() {
  try {
    const raw = localStorage.getItem(scopedKey(COLUMN_HIDDEN_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function setColumnHidden(column, hidden) {
  const current = getHiddenWorkloadColumns();
  if (hidden) current.add(column); else current.delete(column);
  try { localStorage.setItem(scopedKey(COLUMN_HIDDEN_KEY), JSON.stringify(Array.from(current))); } catch { /* ignore */ }
}

export function resetHiddenColumns() {
  try { localStorage.removeItem(scopedKey(COLUMN_HIDDEN_KEY)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// Default sort column
// ---------------------------------------------------------------------------------------------

export const SORTABLE_COLUMNS = [
  { key: "__open", label: "Open" },
  { key: "O&M Status", label: "O&M Status" },
  { key: "Project Picklist", label: "Project Picklist" },
  { key: "Case Owner", label: "Case Owner" },
  { key: "Case Number", label: "Case Number" },
  { key: "Date/Time Opened", label: "Date/Time Opened" },
  { key: "Age (Days)", label: "Age (Days)" }
];

export function getDefaultSortColumn() {
  try {
    const raw = localStorage.getItem(scopedKey(SORT_KEY));
    return raw && SORTABLE_COLUMNS.some((c) => c.key === raw) ? raw : "__open";
  } catch {
    return "__open";
  }
}

export function setDefaultSortColumn(value) {
  try { localStorage.setItem(scopedKey(SORT_KEY), value); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// Row density
// ---------------------------------------------------------------------------------------------

export function getRowDensity() {
  try {
    const raw = localStorage.getItem(scopedKey(DENSITY_KEY));
    return raw === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function setRowDensity(value) {
  try { localStorage.setItem(scopedKey(DENSITY_KEY), value === "compact" ? "compact" : "comfortable"); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------
// Management review names - ties the "Review Me" button to the "Case Last Modified By" column,
// per explicit request: these are the specific people whose edits mean "management already
// touched this case, go review it." Editable (not hardcoded), since the actual roster of
// managers can change over time - defaults to the 3 names given when this was requested.
// ---------------------------------------------------------------------------------------------

const MANAGEMENT_NAMES_KEY = "enquote_workload_management_names_v1";

export const DEFAULT_MANAGEMENT_REVIEW_NAMES = ["Denice Ankenman", "Heather Mackey", "Shane Mosley"];

export function getManagementReviewNames() {
  try {
    const raw = localStorage.getItem(scopedKey(MANAGEMENT_NAMES_KEY));
    if (!raw) return [...DEFAULT_MANAGEMENT_REVIEW_NAMES];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_MANAGEMENT_REVIEW_NAMES];
  } catch {
    return [...DEFAULT_MANAGEMENT_REVIEW_NAMES];
  }
}

export function setManagementReviewNames(names) {
  try {
    const cleaned = (names || []).map((n) => String(n).trim()).filter(Boolean);
    localStorage.setItem(scopedKey(MANAGEMENT_NAMES_KEY), JSON.stringify(cleaned));
  } catch {
    // Ignore storage failures - in-memory state still works this session.
  }
}

export function resetManagementReviewNames() {
  try { localStorage.removeItem(scopedKey(MANAGEMENT_NAMES_KEY)); } catch { /* ignore */ }
}

/** True if the given "Case Last Modified By" value matches any management review name
 *  (case-insensitive, whitespace-trimmed). */
export function isManagementReviewMatch(caseLastModifiedByValue, names) {
  const key = String(caseLastModifiedByValue ?? "").trim().toLowerCase();
  if (!key) return false;
  const list = names || getManagementReviewNames();
  return list.some((n) => String(n).trim().toLowerCase() === key);
}

// ---------------------------------------------------------------------------------------------
// "My Cases" - ties a dedicated toggle to the "Case Owner" column, per explicit request: now
// that the team's Salesforce export includes every team member's cases (not just the signed-in
// person's own), each user needs their own way to filter down to just their own cases.
//
// Stored per-user/per-PC via localStorage, exactly like every other Workload preference here -
// deliberately a SINGLE name (not a list like Management Review Names), since this is "who am
// I", not "who are several people I care about." Defaults to empty (unconfigured) so
// isMyCaseMatch() safely returns false rather than accidentally matching everyone's blank
// Case Owner cells; the Workload table auto-resolves this from the real signed-in user's name
// the first time it's ever loaded with nothing configured yet, but it always remains fully
// editable, since a Salesforce "Case Owner" export can format a name differently
// (e.g. "Carsten Roeschberger" vs. a Salesforce username/alias) than EnQuote's own local
// display name.
//
// CRITICAL: this key is NEVER auto-migrated from any old/shared value (see the file-level v2
// comment) - "my name" is a per-person IDENTITY, not a generic preference, so it must always
// either be this specific user's own real, freshly-resolved name, or genuinely empty (which
// correctly triggers auto-resolution in WorkloadReportTable.jsx) - never another person's name
// copied forward by mistake.
// ---------------------------------------------------------------------------------------------

const MY_NAME_KEY = "enquote_workload_my_name_v1";

export function getMyCaseOwnerName() {
  try {
    return localStorage.getItem(scopedKey(MY_NAME_KEY)) || "";
  } catch {
    return "";
  }
}

export function setMyCaseOwnerName(name) {
  try {
    const trimmed = String(name || "").trim();
    if (trimmed) localStorage.setItem(scopedKey(MY_NAME_KEY), trimmed);
    else localStorage.removeItem(scopedKey(MY_NAME_KEY));
  } catch {
    // Ignore storage failures - in-memory state still works this session.
  }
}

export function resetMyCaseOwnerName() {
  try { localStorage.removeItem(scopedKey(MY_NAME_KEY)); } catch { /* ignore */ }
}

/** True if the given "Case Owner" value matches the configured "my name" (case-insensitive,
 *  whitespace-trimmed). Always false if "my name" has never been configured, so this can never
 *  accidentally match a blank/unset Case Owner cell against a blank/unset preference. */
export function isMyCaseMatch(caseOwnerValue, myName) {
  const name = String(myName ?? getMyCaseOwnerName()).trim();
  if (!name) return false;
  const key = String(caseOwnerValue ?? "").trim().toLowerCase();
  if (!key) return false;
  return key === name.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// "Seen" tracking for tile notifications - per explicit request: "the notifications on the
// sidebar next to Workload should go away after the user has read the notification... they
// should be marked as read after someone clicks the tile." Tracked as a fingerprint of
// caseId + its CURRENT O&M Status (not just caseId alone) - this means if a case's status later
// changes to a DIFFERENT important status (or back out and back into the same tile), it's
// treated as genuinely new information again and reappears as unseen, rather than being
// permanently silenced the first time it was ever seen. If the case's status hasn't changed
// since it was marked seen, it correctly stays "read" across re-imports/app restarts.
//
// NOW ALSO PER-USER: two different people signed in on the same PC will each have their own
// independent "have I seen this" state, since one person clicking a tile to mark it read
// should not silently mark it as read for a teammate who hasn't actually looked at it yet.
// ---------------------------------------------------------------------------------------------

const SEEN_CASE_STATUSES_KEY = "enquote_workload_seen_case_statuses_v1";
// Dispatched on window whenever the seen set changes, so Layout.jsx's sidebar badge (which
// lives outside the Workload page and isn't re-rendered by clicking a tile) can update
// IMMEDIATELY, rather than only on its next mount/focus/visibility-change poll.
const SEEN_CHANGED_EVENT = "enquote-workload-seen-changed";

/** Builds the stable fingerprint used to track "have I seen this case in its current status."
 *  Uses Case ID when present (most stable/unique), falling back to Case Number. */
export function caseStatusFingerprint(row) {
  const id = row?.["Case ID"] || row?.["Case Number"] || "";
  const status = String(row?.["O&M Status"] ?? "").trim().toLowerCase();
  if (!id || !status) return null;
  return `${id}::${status}`;
}

function readSeenFingerprints() {
  try {
    const raw = localStorage.getItem(scopedKey(SEEN_CASE_STATUSES_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSeenFingerprints(set) {
  try {
    localStorage.setItem(scopedKey(SEEN_CASE_STATUSES_KEY), JSON.stringify(Array.from(set)));
  } catch {
    // Ignore storage failures - in-memory behavior for the rest of this session still works.
  }
  try {
    window.dispatchEvent(new CustomEvent(SEEN_CHANGED_EVENT));
  } catch {
    // CustomEvent should always be available in Electron's renderer, but never let a
    // notification-only side effect break the actual read-tracking behavior if it somehow isn't.
  }
}

/** Marks every given row's current case+status fingerprint as "seen" - called when a tile is
 *  clicked, for every row currently mapped to that tile. */
export function markRowsSeen(rows) {
  const seen = readSeenFingerprints();
  let changed = false;
  (rows || []).forEach((row) => {
    const fp = caseStatusFingerprint(row);
    if (fp && !seen.has(fp)) { seen.add(fp); changed = true; }
  });
  if (changed) writeSeenFingerprints(seen);
}

/** True if this exact row (case + its current status) has already been marked seen. */
export function isRowSeen(row) {
  const fp = caseStatusFingerprint(row);
  if (!fp) return false;
  return readSeenFingerprints().has(fp);
}

/** Subscribes to seen-set changes (fired from ANY part of the app, e.g. a tile click on the
 *  Workload page) - returns an unsubscribe function. Used by Layout.jsx so its sidebar badge
 *  updates in real time, not just on its next mount/focus poll. */
export function onSeenChanged(callback) {
  window.addEventListener(SEEN_CHANGED_EVENT, callback);
  return () => window.removeEventListener(SEEN_CHANGED_EVENT, callback);
}

/**
 * Returns the count of rows that are BOTH mapped to a tile (i.e. "important") AND not yet
 * marked seen - this is the single source of truth for "how many unread notifications" both
 * the Workload page's per-tile dot indicators and Layout.jsx's sidebar badge count are driven
 * from, so the two can never drift out of sync with each other.
 */
export function getUnseenImportantCount(rows, tiles) {
  const tileList = tiles || getTiles();
  const seen = readSeenFingerprints();
  let count = 0;
  (rows || []).forEach((row) => {
    if (!getTileForRow(row, tileList)) return;
    const fp = caseStatusFingerprint(row);
    if (fp && !seen.has(fp)) count += 1;
  });
  return count;
}
