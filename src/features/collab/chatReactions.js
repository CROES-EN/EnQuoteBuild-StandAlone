import {getCurrentUserNamespace} from "@/lib/userScopedStorage";

const EVENT = "enquote_chat_reactions_changed";

export function mergeReactions(messages, reactions) {
  return messages.map(message => Object.hasOwn(reactions, message.id)
    ? {...message, reactions: reactions[message.id]} : message);
}

export function notifyChatReactionsChanged(update, owner) {
  if (owner === "__anonymous__" || owner !== getCurrentUserNamespace()) return;
  globalThis.window?.dispatchEvent?.(new CustomEvent(EVENT, {detail: {update, owner}}));
}

export function onChatReactionsChanged(callback) {
  const handler = event => {
    if (event.detail?.owner === getCurrentUserNamespace()) callback(event.detail.update);
  };
  globalThis.window?.addEventListener?.(EVENT, handler);
  return () => globalThis.window?.removeEventListener?.(EVENT, handler);
}
