import {getCurrentUserNamespace} from "@/lib/userScopedStorage";

const EVENT = "enquote_chat_dock_open";

export function isMessagesPage(pathname) {
  return String(pathname || "").replace(/\/+$/, "").toLowerCase() === "/messages";
}

export function openChatDock(conversationId, {minimized = false} = {}) {
  const owner = getCurrentUserNamespace();
  if (!conversationId || owner === "__anonymous__") return;
  globalThis.window?.dispatchEvent?.(new CustomEvent(EVENT, {
    detail: {conversationId, minimized, owner}
  }));
}

export function onChatDockOpen(callback) {
  const handler = event => {
    if (event.detail?.owner === getCurrentUserNamespace()) callback(event.detail);
  };
  globalThis.window?.addEventListener(EVENT, handler);
  return () => globalThis.window?.removeEventListener(EVENT, handler);
}

export function updateDock(state, action) {
  if (action.type === "reset") return {tabs: [], expandedIds: []};
  if (action.type === "close") return {
    tabs: state.tabs.filter(tab => tab.id !== action.id),
    expandedIds: state.expandedIds.filter(id => id !== action.id)
  };
  if (action.type === "minimize") return {...state,
    expandedIds: action.id ? state.expandedIds.filter(id => id !== action.id) : []};
  if (action.type !== "open" || !action.id) return state;
  const tabs = state.tabs.some(tab => tab.id === action.id)
    ? state.tabs.map(tab => tab.id === action.id && !action.minimized ? {...tab, opened: true} : tab)
    : [...state.tabs, {id: action.id, opened: !action.minimized}];
  return {tabs, expandedIds: action.minimized || state.expandedIds.includes(action.id)
    ? state.expandedIds : [...state.expandedIds, action.id]};
}

export function incomingConversationIds(previous, current, email) {
  if (!previous) return [];
  const before = new Map(previous.map(item => [item.id, item.lastMessageAt]));
  return current.filter(item => item.unread > 0 && item.lastSender !== email &&
    item.lastMessageAt && item.lastMessageAt !== before.get(item.id)).map(item => item.id);
}
