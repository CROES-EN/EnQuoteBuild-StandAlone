/**
 * Stores AI-generated Auto-Drafter quote drafts - completely separate from the real
 * `quotes` collection/repository. Uses the exact same window.enquoteLocal.collections
 * bridge as importedTableStore.js's saveReportTable(), under its own separate collection
 * name ("autoDrafterGeneratedDrafts") - never reads or writes the real quotes data, and
 * has no code path into outboundSync.cjs/Base44. Mirrors that module's proven
 * find-then-create-or-update pattern exactly, since the bridge (see electron/preload.cjs)
 * only exposes list/create/update/delete - there is no get-by-id or upsert method.
 *
 * IMPORTANT: "autoDrafterGeneratedDrafts" must be present in BOTH electron/repository.cjs's
 * `collectionNames` array AND its Base44-sync zod schema, or (per a real, previously-fixed
 * bug documented directly in repository.cjs) an incoming Base44 sync would silently wipe
 * this collection's entire contents every time.
 *
 * One record per CASE (keyed by case number, not by draft-generation event) - regenerating
 * a draft for the same case updates its existing record rather than creating a duplicate,
 * matching saveReportTable()'s REPLACE strategy for "current state" data.
 */

import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";

const COLLECTION = "autoDrafterGeneratedDrafts";
const BROWSER_STORAGE_KEY = "enquote_autodrafter_generated_drafts_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

// Lets the UI know whether this is backed by the shared Electron data file (e.g. running
// via `vite dev` in a plain browser tab would not be) - mirrors the same helper name/shape
// already used in importedTableStore.js and opsMetricsStore.js.
export function isElectronBacked() {
  return Boolean(localBridge());
}

function readBrowserStorage() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeBrowserStorage(records) {
  try {
    globalThis.window?.localStorage?.setItem(BROWSER_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Best-effort only, matching importedTableStore.js's same non-throwing convention.
  }
}

async function listLocalOnly() {
  const bridge = localBridge();
  if (bridge) return retryBridgeCall("collections:list (autoDrafterGeneratedDrafts)", () => bridge.list(COLLECTION));
  return readBrowserStorage();
}

/**
 * Returns every saved Auto-Drafter generated draft record.
 */
export async function listGeneratedDrafts() {
  return listLocalOnly();
}

/**
 * Returns the saved draft for a specific case number, or null if none exists yet.
 */
export async function getGeneratedDraftForCase(caseNumber) {
  if (!caseNumber) return null;
  const all = await listLocalOnly();
  return all.find((item) => item.id === String(caseNumber)) || null;
}

/**
 * Saves (creates or updates) the generated draft for a case. `payload` should contain
 * everything the UI needs to render a quote-card-style tile without re-parsing/re-generating:
 *   { caseNumber, siteId, quoteNumber, status, draft, parseWarnings, generatedAt }
 */
export async function saveGeneratedDraft(caseNumber, payload) {
  const record = { id: String(caseNumber), caseNumber: String(caseNumber), ...payload };
  const bridge = localBridge();
  const existing = await listLocalOnly();
  const match = existing.find((item) => item.id === record.id);

  if (bridge) {
    if (match) return retryBridgeCall(`collections:update (autoDrafterGeneratedDrafts:${record.id})`, () => bridge.update(COLLECTION, record.id, record));
    return retryBridgeCall(`collections:create (autoDrafterGeneratedDrafts:${record.id})`, () => bridge.create(COLLECTION, record));
  }

  const next = match
    ? existing.map((item) => (item.id === record.id ? record : item))
    : [...existing, record];
  writeBrowserStorage(next);
  return record;
}

/**
 * Permanently removes a saved generated draft for a case (e.g. if a reviewer wants to
 * discard it and start over). Does NOT affect the real quotes collection.
 */
export async function deleteGeneratedDraft(caseNumber) {
  if (!caseNumber) return;
  const bridge = localBridge();
  if (bridge) {
    return retryBridgeCall(`collections:delete (autoDrafterGeneratedDrafts:${caseNumber})`, () => bridge.delete(COLLECTION, String(caseNumber)));
  }
  const existing = await listLocalOnly();
  writeBrowserStorage(existing.filter((item) => item.id !== String(caseNumber)));
}

/**
 * Permanently removes EVERY saved generated draft ("Clear Generated Drafts" in
 * AutoDrafter.jsx) - lets a reviewer reset the whole board back to raw, not-yet-drafted
 * cases in one action, instead of deleting one-by-one. The bridge (see
 * electron/preload.cjs) only exposes a single-record delete, not a bulk/clear-collection
 * call, so this simply loops deleteGeneratedDraft() over every record currently present.
 * Each delete is awaited in sequence (not Promise.all) to avoid the same
 * read-modify-write race that createCollectionRecord/updateCollectionRecord/
 * deleteCollectionRecord's own serializedWrite() queue was built to prevent in
 * repository.cjs - running many deletes concurrently against the shared local data file
 * could otherwise let one delete's stale read silently undo another's write. Completely
 * separate from the real `quotes` collection - a real Quote record already created via
 * "Send to Quotes" is NEVER touched by this, since it lives in the `quotes` collection,
 * not here.
 */
export async function clearAllGeneratedDrafts() {
  const existing = await listLocalOnly();
  for (const record of existing) {
    await deleteGeneratedDraft(record.caseNumber ?? record.id);
  }
}
