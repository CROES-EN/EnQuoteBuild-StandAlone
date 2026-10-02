/**
 * App-wide error log - a genuinely new capability - so uncaught errors from ANY part of
 * the app (React render crashes via ErrorBoundary, global window.onerror, unhandled promise
 * rejections) are captured and persisted locally, viewable later in the Developer Console
 * (Shift+`), instead of only ever appearing in a DevTools console that's gone the moment
 * DevTools closes.
 *
 * Uses the EXACT SAME window.enquoteLocal.collections bridge and browser-storage fallback
 * pattern as autoImportSettings.js/importedTableStore.js - reusing the already-proven,
 * atomic-write-safe storage path (see repository.cjs's serializedWrite), rather than
 * inventing a second, parallel storage mechanism.
 *
 * IMPORTANT (same requirement as every other collection this app uses): "appErrorLog" must
 * be present in electron/repository.cjs's `collectionNames` array, or the main process
 * rejects every call with "Unsupported local collection: appErrorLog".
 *
 * Unlike autoImportSettings.js (one record per user, upserted), this is an APPEND-ONLY log -
 * every call to recordError() creates a new record. To prevent unbounded growth, the log is
 * capped at MAX_ENTRIES (500) - the oldest entries are pruned once the cap is exceeded,
 * mirroring the same "keep the most recent N" pattern already used elsewhere in this app
 * (useLocalSyncStatus.js's events log slices to -200, main.cjs's rawQueueSample slices to 20).
 */

import {retryBridgeCall} from "@/features/supervisorDashboard/retryBridgeCall";

const COLLECTION = "appErrorLog";
const BROWSER_STORAGE_KEY = "enquote_app_error_log_v1";
const MAX_ENTRIES = 500;

// A per-session counter combined with the current timestamp, so `seq` is guaranteed to
// strictly increase even when multiple errors are recorded within the same millisecond
// (confirmed necessary by a functional test - a tight error loop produced several entries
// sharing the exact same millisecond timestamp, which broke "newest first" sorting when
// sorted by occurredAt alone). Date.now() dominates the value so ordering across
// sessions/app restarts still holds; the counter only breaks ties within a single session.
let sessionCounter = 0;
function nextSeq() {
  sessionCounter = (sessionCounter + 1) % 1000;
  return Date.now() * 1000 + sessionCounter;
}

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

/**
 * Returns every recorded error, newest first - so the Developer Console can show the most
 * recent problems at the top without the caller needing to sort.
 */
export async function listErrors() {
  const bridge = localBridge();
  const all = bridge ? ((await bridge.list(COLLECTION)) || []) : readBrowserStorage();
  // Sorts by `seq`, NOT `occurredAt` alone - see nextSeq()'s comment above for why.
  return [...all].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

/**
 * Records one error. Never throws - a failure to LOG an error must never itself become a
 * second, more disruptive error (e.g. inside ErrorBoundary's own componentDidCatch, or a
 * global window.onerror handler, both of which are already reacting to something going
 * wrong - piling a logging failure on top would only make things worse).
 *
 * @param {object} details
 * @param {string} details.source - where this error was caught, e.g. "ErrorBoundary",
 *   "window.onerror", "unhandledrejection" - so the console can group/filter by origin.
 * @param {string} details.message - the error's own message.
 * @param {string} [details.stack] - the error's stack trace, if available.
 * @param {string} [details.componentStack] - React's component stack, only present for
 *   ErrorBoundary-caught render errors.
 */
export async function recordError({ source, message, stack, componentStack }) {
  // Forward to the shared error reporter first: it is cheap, rate-limited and de-duplicated in
  // the main process, unlike the local log below which rewrites the data file per error.
  try {
    globalThis.window?.enquoteLocal?.errors?.report?.({
      source: source || "unknown",
      message,
      stack: stack || componentStack || "",
      page: globalThis.window?.location?.hash || ""
    });
  } catch {
    // Reporting must never interfere with local logging.
  }
  try {
    const entry = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      seq: nextSeq(),
      source: source || "unknown",
      message: message || "(no message)",
      stack: stack || null,
      componentStack: componentStack || null,
      occurredAt: new Date().toISOString()
    };

    const bridge = localBridge();
    if (bridge) {
      await retryBridgeCall("collections:create (appErrorLog)", () => bridge.create(COLLECTION, entry));
      // Prune oldest entries once over the cap - read-check-delete rather than a dedicated
      // "trim" endpoint, since none exists; acceptable here because this is best-effort
      // housekeeping, not something any other part of the app depends on completing.
      const all = (await bridge.list(COLLECTION)) || [];
      if (all.length > MAX_ENTRIES) {
        const sorted = [...all].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        const toRemove = sorted.slice(0, all.length - MAX_ENTRIES);
        for (const item of toRemove) {
          await bridge.delete(COLLECTION, item.id).catch(() => {});
        }
      }
      return entry;
    }

    const all = readBrowserStorage();
    const next = [...all, entry].slice(-MAX_ENTRIES);
    writeBrowserStorage(next);
    return entry;
  } catch (loggingError) {
    // Logging must never throw back into the caller (see doc comment above).
    console.error("[errorLog] Failed to record error (non-fatal):", loggingError);
    return null;
  }
}

/**
 * Clears every recorded error - used by the Developer Console's "Clear" action.
 */
export async function clearErrors() {
  const bridge = localBridge();
  if (bridge) {
    const all = (await bridge.list(COLLECTION)) || [];
    for (const item of all) {
      await bridge.delete(COLLECTION, item.id).catch(() => {});
    }
    return;
  }
  writeBrowserStorage([]);
}