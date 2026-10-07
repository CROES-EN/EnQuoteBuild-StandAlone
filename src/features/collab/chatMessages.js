import {getCurrentUserNamespace} from "@/lib/userScopedStorage";

const SENT_EVENT = "enquote_chat_message_sent";

export function mergeMessages(current, incoming) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) if (message?.id) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function notifyChatMessageSent(message, owner) {
  if (!message?.id || !message.conversationId || owner === "__anonymous__" ||
      owner !== getCurrentUserNamespace()) return;
  globalThis.window?.dispatchEvent?.(new CustomEvent(SENT_EVENT, {detail: {message, owner}}));
}

export function onChatMessageSent(callback) {
  const handler = event => {
    if (event.detail?.owner === getCurrentUserNamespace()) callback(event.detail.message);
  };
  globalThis.window?.addEventListener?.(SENT_EVENT, handler);
  return () => globalThis.window?.removeEventListener?.(SENT_EVENT, handler);
}
