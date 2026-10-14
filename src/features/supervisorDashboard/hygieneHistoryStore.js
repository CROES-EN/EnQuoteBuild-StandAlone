/**
 * One Data Hygiene summary per report date, so flag counts can be trended over time.
 * Saved locally (collection "quoteRequestHygieneDaily", registered in electron/repository.cjs).
 * A report re-imported on the same date replaces that date's summary.
 */
import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";
import {buildQuoteRequestHygieneReport} from "@/features/autoDrafter/quoteRequestHygiene";
import {hygieneSnapshotFromReport, localDateString} from "@/features/supervisorDashboard/supervisorInsights";

const COLLECTION = "quoteRequestHygieneDaily";
const BROWSER_STORAGE_KEY = "enquote_quote_request_hygiene_daily_v1";
const recorded = new Set();
const inFlight = new Map();

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

// A desktop app whose main process predates this collection rejects it until fully restarted;
// keep history in browser storage meanwhile and move it into the collection afterwards.
const isUnsupportedCollection = error => /Unsupported local collection/i.test(error?.message || "");

function readBrowserStorage() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
    const records = raw ? JSON.parse(raw) : [];
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeBrowserStorage(records) {
  if (records.length) globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
  else globalThis.window?.localStorage?.removeItem(BROWSER_STORAGE_KEY);
}

const isNewer = (candidate, existing) => !existing || existing.is_deleted ||
  String(candidate.importedAt || "") > String(existing.importedAt || "");

async function listFromBridge(bridge) {
  const records = await retryBridgeCall(`collections:list (${COLLECTION})`, () => bridge.list(COLLECTION));
  const pending = readBrowserStorage();
  if (!pending.length) return records;
  const byId = new Map(records.map(record => [record.id, record]));
  for (const record of pending) {
    const existing = byId.get(record.id);
    if (!isNewer(record, existing)) continue;
    const saved = await (existing
      ? retryBridgeCall(`collections:update (${COLLECTION})`, () => bridge.update(COLLECTION, record.id, record))
      : retryBridgeCall(`collections:create (${COLLECTION})`, () => bridge.create(COLLECTION, record)));
    byId.set(record.id, saved && typeof saved === "object" ? saved : record);
  }
  writeBrowserStorage([]);
  return [...byId.values()];
}

async function listAll() {
  const bridge = localBridge();
  if (!bridge) return readBrowserStorage();
  try {
    return await listFromBridge(bridge);
  } catch (error) {
    if (!isUnsupportedCollection(error)) throw error;
    return readBrowserStorage();
  }
}

export async function listHygieneHistory() {
  return (await listAll()).filter(record => !record.is_deleted);
}

/** Saves the day's summary for an imported request table; resolves true when something was written. */
export function recordHygieneSnapshot(table) {
  if (!table?.rows?.length) return Promise.resolve(false);
  const date = localDateString(table.importedAt || new Date());
  const key = `${date}|${table.importedAt || ""}`;
  if (!date || recorded.has(key)) return Promise.resolve(false);
  // Several mounted views share this hook; one write per report import is enough.
  if (!inFlight.has(key)) inFlight.set(key, writeSnapshot(table, date, key).finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

function writeToBrowserStorage(snapshot) {
  const records = readBrowserStorage();
  if (!isNewer(snapshot, records.find(record => record.id === snapshot.id))) return false;
  writeBrowserStorage([...records.filter(record => record.id !== snapshot.id), snapshot]);
  return true;
}

async function writeToBridge(bridge, snapshot) {
  const existing = (await listFromBridge(bridge)).find(record => record.id === snapshot.id);
  if (!isNewer(snapshot, existing)) return false;
  await (existing
    ? retryBridgeCall(`collections:update (${COLLECTION})`, () => bridge.update(COLLECTION, snapshot.id, snapshot))
    : retryBridgeCall(`collections:create (${COLLECTION})`, () => bridge.create(COLLECTION, snapshot)));
  return true;
}

async function writeSnapshot(table, date, key) {
  const snapshot = hygieneSnapshotFromReport(buildQuoteRequestHygieneReport(table), date);
  const bridge = localBridge();
  let written;
  if (!bridge) written = writeToBrowserStorage(snapshot);
  else {
    try {
      written = await writeToBridge(bridge, snapshot);
    } catch (error) {
      if (!isUnsupportedCollection(error)) throw error;
      written = writeToBrowserStorage(snapshot);
    }
  }
  recorded.add(key);
  return written;
}
