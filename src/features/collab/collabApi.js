// Renderer access to the per-user features (Tasks, SOP Library, Messages) exposed by the
// Electron preload bridge. Every call resolves to a plain value or throws an Error with a
// readable message, so pages never need to know about IPC result shapes.
import {useEffect, useState} from "react";
import {openChatDock} from "./chatDockState";
import {notifyChatMessageSent} from "./chatMessages";
import {notifyChatReactionsChanged} from "./chatReactions";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";

const bridge = () => globalThis.window?.enquoteLocal || {};

export function hasCollabBridge() {
  return Boolean(bridge().tasks?.list);
}

const FRIENDLY_ERRORS = {
  not_connected: "EnQuote is still connecting to the sync service. Try again in a moment.",
  unreachable: "Couldn't reach the sync service. Check your connection and try again.",
  user_tokens_not_configured: "This feature hasn't been switched on for your team yet.",
  invalid_user_token: "Your sign-in needs refreshing. Restart EnQuote and try again.",
  user_token_expired: "Your sign-in needs refreshing. Restart EnQuote and try again.",
  email_not_allowed: "Your account isn't on the EnQuote access list.",
  not_found: "That item no longer exists.",
  file_too_large: "Files must be 20 MB or smaller.",
  unsupported_type: "That file type isn't supported. Use PDF, Word (.docx), images, or text.",
  unsupported_file_type: "That file type isn't supported. Use PDF, Word (.docx), images, or text.",
  unknown_member: "One of the people you picked isn't on the EnQuote access list.",
  stamp_in_future: "Your PC clock looks wrong. Check the date and time, then try again.",
  invalid_case_task: "Check the case details and pick a valid due date and time.",
  invalid_case_task_recipient: "Choose a teammate from the directory for this case task.",
  image_too_large: "Screenshots must be 5 MB or smaller.",
  unsupported_image_type: "Paste a PNG, JPEG, WebP, or GIF image.",
  invalid_image: "That screenshot is not a valid supported image.",
  invalid_image_attachment: "The screenshot could not be attached. Try sending it again.",
  invalid_reaction: "Choose a supported message reaction.",
  invalid_emoji_name: "Use 1-32 lowercase letters, numbers, underscores, or hyphens for the emoji name.",
  emoji_too_large: "Custom emojis must be 512 KB or smaller.",
  emoji_already_exists: "That emoji name or image is already in the shared library. Choose a different name or use the existing emoji.",
  invalid_custom_emoji: "That custom emoji is not in the shared library. Refresh the picker.",
  invalid_gif_emoji: "That GIPHY result cannot be saved as an animated emoji. Choose a different GIF.",
  gifs_not_configured: "GIF search hasn't been switched on for your team yet.",
  gifs_unavailable: "Could not reach GIPHY. Please try again.",
  invalid_app_link: "That EnQuote link is invalid. Pick the item again.",
  invalid_assigned_task: "Enter a title, valid due date and time, and notes of up to 2,000 characters."
};

export function friendlyError(result) {
  const code = result?.reason || result?.error;
  return FRIENDLY_ERRORS[code] || FRIENDLY_ERRORS[result?.error] || result?.error || "Something went wrong. Try again.";
}

async function call(path, ...args) {
  const [group, method] = path.split(".");
  const fn = bridge()[group]?.[method];
  if (typeof fn !== "function") throw new Error("This feature is only available in the EnQuote desktop app.");
  let result;
  try {
    result = await fn(...args);
  } catch (failure) {
    if (!/No handler registered for/.test(failure?.message || "")) throw failure;
    const error = new Error("EnQuote needs a full restart to load the updated messaging service. Close EnQuote completely and reopen it; reloading this page is not enough.");
    error.code = "desktop_restart_required";
    throw error;
  }
  if (result && typeof result === "object" && result.ok === false && result.reason !== "conflict") {
    if (["chat.emojis", "chat.uploadEmoji", "chat.saveGifEmoji"].includes(path) &&
        [result.reason, result.error].some(code => code === "not_found" || code === "http_404")) {
      const error = new Error("The sync service does not have the shared emoji endpoint yet. Deploy the updated Worker and apply the custom emoji database migration before saving emojis.");
      error.code = "emoji_service_update_required";
      throw error;
    }
    const error = new Error(friendlyError(result));
    error.code = result.reason || result.error;
    throw error;
  }
  return result;
}

const list = (value, key) => (Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : []);

export const tasksApi = {
  list: async () => list(await call("tasks.list"), "tasks"),
  save: async (record) => (await call("tasks.save", record))?.task,
  delete: (id) => call("tasks.delete", id),
  syncNow: () => call("tasks.syncNow").catch(() => null)
};

export const sopsApi = {
  list: async () => list(await call("sops.list"), "sops"),
  sync: () => call("sops.sync").catch(() => null),
  save: (record, options) => call("sops.save", record, options),
  delete: (id) => call("sops.delete", id),
  versions: async (id) => list(await call("sops.versions", id), "versions"),
  uploadFile: async (file) => (await call("sops.uploadFile", file))?.file,
  getFile: (fileId, meta) => call("sops.getFile", fileId, meta),
  prepareOneNote: () => call("sops.prepareOneNote"),
  importOneNote: (payload) => call("sops.importOneNote", payload),
  cancelOneNote: (sessionId) => call("sops.cancelOneNote", sessionId)
};

export const chatApi = {
  me: () => call("chat.me"),
  directory: async (options) => list(await call("chat.directory", options), "users"),
  conversations: async () => list(await call("chat.conversations"), "conversations"),
  openDm: async (email) => (await call("chat.openDm", email))?.conversation,
  createGroup: async (payload) => (await call("chat.createGroup", payload))?.conversation,
  updateConversation: async (payload) => (await call("chat.updateConversation", payload))?.conversation,
  messages: async (query) => list(await call("chat.messages", query), "messages"),
  reactions: async query => {
    const result = await call("chat.reactions", query);
    if (!result?.reactions) throw new Error("Could not load message reactions. Please try again.");
    return result;
  },
  react: async payload => {
    const owner = getCurrentUserNamespace();
    const result = await call("chat.react", payload);
    if (!result?.reactions) throw new Error("Could not update the reaction. Please try again.");
    if (owner === getCurrentUserNamespace()) notifyChatReactionsChanged(result, owner);
    return result;
  },
  send: async (payload) => {
    const owner = getCurrentUserNamespace();
    const message = (await call("chat.send", payload))?.message;
    if (message && owner === getCurrentUserNamespace()) {
      notifyChatMessageSent(message, owner);
      openChatDock(payload.conversationId);
    }
    return message;
  },
  getImage: async (query) => (await call("chat.getImage", query))?.dataUrl,
  emojis: async () => {
    const result = await call("chat.emojis");
    if (!Array.isArray(result?.emojis)) throw new Error("Could not load the shared emoji library.");
    return result.emojis;
  },
  uploadEmoji: async payload => {
    const result = await call("chat.uploadEmoji", payload);
    if (!result?.emoji?.id) throw new Error("The custom emoji upload was not confirmed.");
    return result.emoji;
  },
  getEmoji: async id => {
    const result = await call("chat.getEmoji", id);
    if (!result?.dataUrl) throw new Error("Could not load this custom emoji image.");
    return result.dataUrl;
  },
  saveGifEmoji: async payload => {
    const result = await call("chat.saveGifEmoji", payload);
    if (!result?.emoji?.id) throw new Error("Saving the GIF as an emoji was not confirmed.");
    return result.emoji;
  },
  markRead: (payload) => call("chat.markRead", payload).catch(() => null),
  setActiveConversation: (id) => call("chat.setActiveConversation", id).catch(() => null)
};

const activeChatViews = new Map();
function syncActiveChatView() {
  const owner = getCurrentUserNamespace();
  const active = [...activeChatViews.values()].filter(view => view.owner === owner)
    .sort((a, b) => b.priority - a.priority)[0];
  void chatApi.setActiveConversation(active?.conversationId || null);
}

export function registerActiveChatView(conversationId, priority = 0) {
  const key = Symbol("chat-view");
  activeChatViews.set(key, {conversationId, priority, owner: getCurrentUserNamespace()});
  syncActiveChatView();
  return () => {
    activeChatViews.delete(key);
    syncActiveChatView();
  };
}

export function subscribe(group, event, callback) {
  const fn = bridge()[group]?.[event];
  if (typeof fn !== "function") return () => {};
  const unsubscribe = fn(callback);
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

// Live task list for the signed-in user (updates when reminders fire or another PC syncs).
export function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (isReadonlyViewing()) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    tasksApi.list()
      .then((items) => { if (!cancelled) setTasks(items); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    const off = subscribe("tasks", "onChanged", (items) => { if (Array.isArray(items)) setTasks(items); });
    return () => { cancelled = true; off(); };
  }, []);
  return { tasks, loading };
}

// Tasks needing attention now: open, and either overdue or with a reminder that has fired.
export function countAttentionTasks(tasks, nowMs = Date.now()) {
  return tasks.filter((task) => {
    if (task.status === "done") return false;
    const due = Date.parse(task.due_at || "");
    const remind = Date.parse(task.snoozed_until || task.remind_at || "");
    return (Number.isFinite(due) && due <= nowMs) || (Number.isFinite(remind) && remind <= nowMs);
  }).length;
}

export function useChatUnread() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isReadonlyViewing()) return undefined;
    let cancelled = false;
    chatApi.me().then((me) => { if (!cancelled && Number.isFinite(me?.unreadTotal)) setUnread(me.unreadTotal); }).catch(() => {});
    const off = subscribe("chat", "onUpdated", (update) => {
      if (Number.isFinite(update?.unreadTotal)) setUnread(update.unreadTotal);
    });
    return () => { cancelled = true; off(); };
  }, []);
  return unread;
}
