/**
 * App notifications (quote updates, product updates, quote-sent-to-Base44 events) -
 * mirrors errorLog.js's EXACT proven structure: same collections-bridge pattern, same
 * browser-storage fallback, same seq-based ordering (Date.now() * 1000 + a per-session
 * counter) to avoid the same-millisecond sort bug already found and fixed in errorLog.js.
 *
 * Notification RECORDS themselves are generated server-side (electron/repository.cjs's
 * importData(), electron/outboundSync.cjs's flush()) - this file only reads/marks-read
 * from the renderer, via the SAME generic collections:list/update bridge already used
 * for every other local collection. No new IPC handlers were needed for this feature.
 *
 * IMPORTANT (same requirement as every other collection this app uses): "appNotifications"
 * must be present in electron/repository.cjs's `collectionNames` array, or the main
 * process rejects every call with "Unsupported local collection: appNotifications".
 */

const COLLECTION = "appNotifications";
const BROWSER_STORAGE_KEY = "enquote_app_notifications_v1";

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
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
 * Returns every notification, newest first (sorted by `seq`, not `occurredAt` alone -
 * same reasoning as errorLog.js: rapid-fire entries can share the exact same millisecond
 * timestamp, which breaks naive timestamp-only sorting).
 */
export async function listNotifications() {
  const bridge = localBridge();
  const all = bridge ? ((await bridge.list(COLLECTION)) || []) : readBrowserStorage();
  return [...all].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
}

/**
 * Marks every currently-unread notification as read - called when the bell's popover is
 * opened, per explicit request: "an unread badge that clears once opened."
 */
export async function markAllRead() {
  const bridge = localBridge();
  if (bridge) {
    const all = (await bridge.list(COLLECTION)) || [];
    for (const item of all.filter((n) => !n.read)) {
      await bridge.update(COLLECTION, item.id, { read: true }).catch(() => {});
    }
    return;
  }
  const all = readBrowserStorage();
  writeBrowserStorage(all.map((n) => ({ ...n, read: true })));
}

/**
 * Deletes exactly one notification - used by the bell's per-item "Clear" button. Mirrors
 * markAllRead's exact bridge-vs-browser-storage fallback pattern above.
 */
export async function clearNotification(id) {
  const bridge = localBridge();
  if (bridge) {
    await bridge.delete(COLLECTION, id).catch(() => {});
    return;
  }
  const all = readBrowserStorage();
  writeBrowserStorage(all.filter((n) => n.id !== id));
}