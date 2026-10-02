/**
 * Stores raw, row-level report data (Escalations, Audits, Care-Cases, O&M-CS-Cases,
 * Incorta-O&M-Input, SFDC-Quotes, etc.) for browsing inside EnQuote - completely separate
 * from opsMetricsStore.js, which only holds DAILY AGGREGATE numbers (calls handled, quotes
 * drafted, etc.). This store keeps full rows so nothing is lost to aggregation, since case
 * numbers/owners/statuses can't be meaningfully summed into a single daily value.
 *
 * Uses the exact same window.enquoteLocal.collections bridge as opsMetricsStore.js, under its
 * own separate collection name ("supervisorReportTables") - never reads or writes
 * opsMetricsStore's "supervisorDailyMetrics" collection.
 *
 * IMPORTANT: the bridge (see electron/preload.cjs) only exposes list/create/update/delete -
 * there is no get-by-id or upsert method. saveReportTable() below does its own
 * find-then-create-or-update against the full list, exactly like opsMetricsStore.js's
 * saveDailyMetric() does for the same reason.
 *
 * Also note: "supervisorReportTables" must be present in electron/repository.cjs's
 * `collectionNames` array, or the main process rejects every call with
 * "Unsupported local collection: supervisorReportTables" - see repository.cjs.
 *
 * Re-import strategy: REPLACE. Each import fully replaces the previous rows for that report
 * type, because this data represents "current state" (a case's status changes over time) - it
 * is not a daily log, so keeping stale rows alongside fresh ones would let a case with an old,
 * already-changed status linger and mislead anyone browsing the table. If historical revisions
 * are ever wanted, this is a well-contained place to add a separate revisions table later.
 */

import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";

const COLLECTION = "supervisorReportTables";
const BROWSER_STORAGE_KEY = "enquote_supervisor_report_tables_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

// Lets the UI show a small notice when it's not backed by the shared Electron data file
// (e.g. running via `vite dev` in a plain browser tab) - mirrors opsMetricsStore.js's helper
// of the same name (kept separate/duplicated rather than imported, since this module is
// deliberately independent of opsMetricsStore.js).
export function isElectronBacked() {
  return Boolean(localBridge());
}

function readBrowserStorage() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBrowserStorage(records) {
  try {
    globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures (e.g. private-browsing quota) - in-memory state still works this session.
  }
}

// Reads this machine's local copy. The main process mirrors this collection to the shared
// Cloudflare store (see electron/supervisorSync.cjs) and applies remote changes into it, so
// every manager's dashboard ends up showing the same imported data.
async function listAll() {
  const bridge = localBridge();
  if (bridge) return (await bridge.list(COLLECTION)) || [];
  return readBrowserStorage();
}

async function getLocalReportTable(reportType) {
  const all = await listAll();
  return all.find((item) => item.id === reportType) ?? null;
}

// --- Incremental import / change detection ---------------------------------------
//
// Cheap, non-cryptographic content hash (this is content-addressing to detect "did
// this data change", not a security boundary, so a fast hash is fine - no need for
// node:crypto in this renderer-side module). Object.keys().sort() makes the hash
// independent of key ordering, so the same row imported twice always hashes the same
// way even if the source file's column order shifted slightly.
function hashRow(row) {
  const sortedKeys = Object.keys(row || {}).sort();
  const normalized = sortedKeys.map((k) => `${k}=${JSON.stringify(row[k])}`).join("|");
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return hash;
}

// Order-independent whole-table hash - sorting the individual row hashes means a
// re-export with the same rows in a different order still correctly compares as
// "unchanged", rather than a false "changed" purely from row reordering.
function hashTable(rows) {
  const hashes = (Array.isArray(rows) ? rows : []).map(hashRow).sort((a, b) => a - b);
  return hashes.join(",");
}

// Informational only (does not affect whether the save happens) - reports how many
// rows are new/changed/unchanged/removed compared to what's currently stored, so a
// real import (one that DOES change something) still tells you what changed. When
// `keyField` is omitted, "changed" rows cannot be distinguished from a
// remove-and-re-add pair (both show up as new + removed) - pass the report's real
// unique-id column name (e.g. "Case Number", "Id") for accurate changed-row counts.
function diffRows(existingRows, incomingRows, keyField = null) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];

  const keyOf = (row) => (keyField && row?.[keyField] !== undefined && row?.[keyField] !== null)
    ? `k:${row[keyField]}`
    : `h:${hashRow(row)}`;

  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const incomingByKey = new Map(incoming.map((row) => [keyOf(row), row]));

  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const [key, row] of incomingByKey) {
    const prior = existingByKey.get(key);
    if (!prior) {
      newCount += 1;
    } else if (keyField && hashRow(prior) !== hashRow(row)) {
      changedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  const removedCount = keyField
    ? [...existingByKey.keys()].filter((key) => !incomingByKey.has(key)).length
    : Math.max(0, existing.length - incoming.length);

  return { newCount, changedCount, unchangedCount, removedCount };
}

/**
 * Replaces all rows for a given report type with a fresh import. Uses `reportType` as the
 * record's `id` (one record per report type, same one-record-per-key pattern opsMetricsStore.js
 * uses with `date` as the id), so re-importing the same report type updates its existing record
 * instead of accumulating duplicates.
 *
 * @param {string} reportType - stable key, e.g. "escalations", "audits", "care_cases",
 *   "om_cs_cases", "incorta_input", "sfdc_quotes"
 * @param {object} payload
 * @param {string[]} payload.columns - column headers, in original file order
 * @param {Array<Record<string, any>>} payload.rows - each row as {columnName: value}
 * @param {string} payload.sourceFileName
 * @param {string} payload.importedAt - ISO timestamp
 */
export async function saveReportTable(reportType, { columns, rows, sourceFileName, importedAt, importMethod }, options = {}) {
  const { keyField = null, force = false } = options;
  const record = { id: reportType, reportType, columns, rows, sourceFileName, importedAt, importMethod: importMethod || "manual" };
  const bridge = localBridge();
  const existing = await listAll();
  const match = existing.find((item) => item.id === reportType);

  // Skip the entire save when this import is byte-for-byte identical to what's
  // already stored - covers the common "routine/duplicate re-import of the same
  // export" case, which previously still triggered a full rewrite of the shared
  // data file every time regardless of whether anything actually changed.
  if (match && !force) {
    const existingHash = hashTable(match.rows);
    const incomingHash = hashTable(rows);
    if (existingHash === incomingHash) {
      console.log(`[importedTableStore] "${reportType}": no changes detected in ${Array.isArray(rows) ? rows.length : 0} row(s) - skipping save.`);
      return match;
    }
    const diff = diffRows(match.rows, rows, keyField);
    console.log(`[importedTableStore] "${reportType}": ${diff.newCount} new, ${diff.changedCount} changed, ${diff.unchangedCount} unchanged, ${diff.removedCount} removed - saving.`);
  }

  if (bridge) {
    if (match) return retryBridgeCall(`collections:update (${reportType})`, () => bridge.update(COLLECTION, reportType, record));
    return retryBridgeCall(`collections:create (${reportType})`, () => bridge.create(COLLECTION, record));
  }

  const next = match
    ? existing.map((item) => (item.id === reportType ? record : item))
    : [...existing, record];
  writeBrowserStorage(next);
  return record;
}

/**
 * Merges an OM Staffing Report import into the "staffing" report table, keyed by DATE instead
 * of replacing the whole table like saveReportTable() does for every other report type (see the
 * module-level comment above for why Staffing needs to stay a time series). This report's CSV
 * export (see parseOMStaffingReport.js) already includes a real "Date" column on every row -
 * unlike the old single-day Supervisor Snapshot format this replaced, which had no date column
 * at all and required the caller to supply one date for the whole file.
 *
 * Merge behavior: every DISTINCT date present in `rows` has its previously-stored rows fully
 * replaced; every other previously-stored date's rows are left untouched. This correctly
 * supports importing either a single day's export or a multi-day historical export (this
 * report's CSV can cover any date range) in one call, without ever duplicating rows on
 * re-import - as long as every row in `rows` already carries its own real "Date" value.
 *
 * @param {object} payload
 * @param {string[]} payload.columns - column headers, starting with "Date" (this report's own
 *   header row always starts with "Date" - never prepend a second one here).
 * @param {Array<Record<string, any>>} payload.rows - each row as {columnName: value}, where
 *   every row MUST already include its own "Date" value (e.g. row.Date === "2026/07/01").
 * @param {string} payload.sourceFileName
 * @param {string} payload.importedAt - ISO timestamp
 */
export async function saveStaffingSnapshot({ columns, rows, sourceFileName, importedAt }) {
  const reportType = "staffing";
  const existing = await getLocalReportTable(reportType);
  const mergedColumns = existing?.columns?.length ? existing.columns : columns;

  const incomingDates = new Set(rows.map((row) => row.Date));
  const priorRowsOtherDates = (existing?.rows || []).filter((row) => !incomingDates.has(row.Date));
  const mergedRows = [...priorRowsOtherDates, ...rows].sort((a, b) => String(a.Date).localeCompare(String(b.Date)));

  const record = { id: reportType, reportType, columns: mergedColumns, rows: mergedRows, sourceFileName, importedAt };

  const bridge = localBridge();
  if (bridge) {
    if (existing) return retryBridgeCall("collections:update (staffing)", () => bridge.update(COLLECTION, reportType, record));
    return retryBridgeCall("collections:create (staffing)", () => bridge.create(COLLECTION, record));
  }

  const all = readBrowserStorage();
  const match = all.find((item) => item.id === reportType);
  const next = match ? all.map((item) => (item.id === reportType ? record : item)) : [...all, record];
  writeBrowserStorage(next);
  return record;
}

/** Returns the stored table for one report type, or null if never imported. */
export async function getReportTable(reportType) {
  const all = await listAll();
  return all.find((item) => item.id === reportType) ?? null;
}

/** Returns { [reportType]: record } for every report type that has been imported at least once. */
export async function listReportTables() {
  const all = await listAll();
  return Object.fromEntries(all.map((r) => [r.reportType, r]));
}

export async function deleteReportTable(reportType) {
  const bridge = localBridge();
  if (bridge) {
    try {
      await bridge.delete(COLLECTION, reportType);
    } catch (error) {
      // "record not found" means this report type was never saved locally on this machine,
      // so the end state the caller wants (gone from local storage) is already true - treated
      // as a successful no-op rather than a hard failure. Any
      // OTHER error (a real IPC/disk failure) still throws normally.
      const message = String(error?.message || "");
      if (!message.includes("record not found")) throw error;
    }
    return;
  }
  const all = readBrowserStorage();
  writeBrowserStorage(all.filter((item) => item.id !== reportType));
}

