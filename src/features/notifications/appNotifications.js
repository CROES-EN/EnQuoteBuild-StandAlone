/**
 * Notification records come from the local collections bridge. Read/dismissed state is
 * saved separately per signed-in user, so a background database write cannot restore
 * cleared notifications. Event keys also suppress replays with regenerated record IDs.
 */

import {getCurrentUserNamespace, scopedKey} from "@/lib/userScopedStorage";
import {tasksApi} from "@/features/collab/collabApi";

const COLLECTION = "appNotifications";
const BROWSER_STORAGE_KEY = "enquote_app_notifications_v1";
const STATE_KEY = "enquote_notification_state_v1";

function eventKey(item) {
  const rawTime = item.occurredAt;
  const time = typeof rawTime === "string"
    ? Date.parse(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(rawTime) ? `${rawTime}Z` : rawTime)
    : NaN;
  return JSON.stringify([item.type, item.quoteId || item.productName || item.taskId || item.id,
    Number.isFinite(time) ? time : rawTime]);
}

function readState(key = scopedKey(STATE_KEY)) {
  const raw = globalThis.window?.localStorage?.getItem(key);
  if (!raw) return {dismissed: [], read: []};
  const state = JSON.parse(raw);
  if (!Array.isArray(state.dismissed) || !Array.isArray(state.read)) throw new Error("Saved notification state is invalid.");
  return state;
}

function saveState(state, key) {
  const storage = globalThis.window?.localStorage;
  if (!storage) throw new Error("Notification storage is unavailable.");
  storage.setItem(key, JSON.stringify(state));
}

function remember(items, field, key) {
  const state = readState(key);
  state[field] = [...new Set([...state[field], ...items.flatMap(item =>
    [item.id, eventKey(item), ...(item.eventId ? [item.eventId] : [])])])];
  saveState(state, key);
}

function localBridge() {
  return globalThis.window?.enquoteLocal?.collections || null;
}

function readBrowserStorage() {
  const raw = globalThis.window?.localStorage?.getItem(BROWSER_STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error("Saved notifications are invalid.");
  return parsed;
}

/**
 * Returns every notification, newest first (sorted by `seq`, not `occurredAt` alone -
 * same reasoning as errorLog.js: rapid-fire entries can share the exact same millisecond
 * timestamp, which breaks naive timestamp-only sorting).
 */
export async function listNotifications() {
  const owner = getCurrentUserNamespace();
  if (owner === "__anonymous__") return [];
  const state = readState();
  const bridge = localBridge();
  const [stored, tasks] = await Promise.all([
    bridge ? bridge.list(COLLECTION) : readBrowserStorage(),
    globalThis.window?.enquoteLocal?.tasks?.list ? tasksApi.list() : []
  ]);
  if (owner !== getCurrentUserNamespace()) return [];
  const assignments = tasks.filter(task => task.assigned_by && task.assigned_by.toLowerCase() !== owner)
    .map(task => ({
      id: `task-assigned:${task.id}`,
      eventId: `task-assigned:${task.id}`,
      type: "task_assigned",
      taskId: task.id,
      taskTitle: task.title,
      changedBy: task.assigned_by,
      occurredAt: task.created_date,
      seq: (Date.parse(task.created_date) || 0) * 1000
    }));
  const all = [...(stored || []), ...assignments];
  const dismissed = new Set(state.dismissed);
  const read = new Set(state.read);
  const seen = new Set();
  return [...all].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    .filter(item => {
      const key = item.eventId || eventKey(item);
      if (dismissed.has(item.id) || dismissed.has(eventKey(item)) || dismissed.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => ({...item, read: read.has(item.id) || read.has(eventKey(item)) || read.has(item.eventId)}));
}

/**
 * Marks every currently-unread notification as read - called when the bell's popover is
 * opened, per explicit request: "an unread badge that clears once opened."
 */
export async function markAllRead() {
  const key = scopedKey(STATE_KEY);
  remember(await listNotifications(), "read", key);
}

/** Persistently dismisses one notification for this user on this device. */
export async function clearNotification(id) {
  const key = scopedKey(STATE_KEY);
  remember((await listNotifications()).filter(item => item.id === id), "dismissed", key);
}

/** Dismisses the displayed snapshot, leaving notifications arriving afterward untouched. */
export async function clearAllNotifications(items) {
  const key = scopedKey(STATE_KEY);
  remember(items || await listNotifications(), "dismissed", key);
}