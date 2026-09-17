/**
 * Per-user Auto-Import settings (whether it's on/off, which local folder to watch) - keyed by
 * the signed-in user's email (see RoleGuard.jsx's useUserRole()/useCurrentUserQuery(), which
 * resolves `user` from Base44's own auth), so each person using this EnQuote installation gets
 * their own independent folder/toggle, rather than one shared global setting.
 *
 * Uses the EXACT SAME window.enquoteLocal.collections bridge, list-then-create-or-update
 * pattern, and browser-storage fallback as importedTableStore.js/opsMetricsStore.js - reusing
 * the already-proven, atomic-write-safe (see repository.cjs's write() fix) storage path,
 * rather than inventing a second, parallel storage mechanism for this new setting.
 *
 * IMPORTANT (same requirement as every other collection this app uses): "autoImportSettings"
 * must be present in electron/repository.cjs's `collectionNames` array, or the main process
 * rejects every call with "Unsupported local collection: autoImportSettings".
 */

import { retryBridgeCall } from "@/features/supervisorDashboard/retryBridgeCall";

const COLLECTION = "autoImportSettings";
const BROWSER_STORAGE_KEY = "enquote_auto_import_settings_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

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

async function listAll() {
  const bridge = localBridge();
  if (bridge) return (await bridge.list(COLLECTION)) || [];
  return readBrowserStorage();
}

/**
 * The default shape for a user who has never configured auto-import before - disabled, no
 * folder chosen yet (per explicit request: "make it a blank folder"), and the Calls/Emails
 * subfolder-creation prompt not yet answered either way.
 */
function defaultSettingsFor(userEmail) {
  return {
    id: userEmail,
    userEmail,
    enabled: false,
    watchFolderPath: null,
    subfoldersCreated: false,
    updatedAt: null
  };
}

/**
 * Returns the current auto-import settings for one user, or sensible defaults (NOT yet saved)
 * if this user has never configured it before - mirrors getReportTable()'s
 * "return null if never imported" pattern, except here we return safe defaults instead of null
 * so callers never need a separate null-check before reading `.enabled`/`.watchFolderPath`.
 *
 * @param {string} userEmail - the signed-in user's email (stable per-user key).
 */
export async function getAutoImportSettings(userEmail) {
  if (!userEmail) return defaultSettingsFor("");
  const all = await listAll();
  const match = all.find((item) => item.id === userEmail);
  return match ?? defaultSettingsFor(userEmail);
}

/**
 * Saves (creates or updates) one user's auto-import settings - same find-then-create-or-update
 * pattern as saveReportTable(), since the bridge has no upsert method of its own.
 *
 * @param {string} userEmail
 * @param {object} partialSettings - any subset of { enabled, watchFolderPath, subfoldersCreated }
 *   to merge into this user's existing settings (existing fields not present here are kept
 *   as-is, same "merge, don't clobber" behavior as saveStaffingSnapshot()'s date-based merge).
 */
export async function saveAutoImportSettings(userEmail, partialSettings) {
  if (!userEmail) throw new Error("saveAutoImportSettings requires a signed-in user's email.");

  const existing = await getAutoImportSettings(userEmail);
  const record = {
    ...existing,
    ...partialSettings,
    id: userEmail,
    userEmail,
    updatedAt: new Date().toISOString()
  };

  const bridge = localBridge();
  const all = await listAll();
  const alreadyStored = all.some((item) => item.id === userEmail);

  if (bridge) {
    if (alreadyStored) return retryBridgeCall("collections:update (autoImportSettings)", () => bridge.update(COLLECTION, userEmail, record));
    return retryBridgeCall("collections:create (autoImportSettings)", () => bridge.create(COLLECTION, record));
  }

  const next = alreadyStored
    ? all.map((item) => (item.id === userEmail ? record : item))
    : [...all, record];
  writeBrowserStorage(next);
  return record;
}
