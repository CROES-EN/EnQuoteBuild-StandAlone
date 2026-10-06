import {scopedKey, onUserSessionChanged} from "../../lib/userScopedStorage.js";
import {readableForegroundHex} from "../theme/customThemeBuilder.js";

const STORAGE_KEY = "enquote_chat_appearance_v1";
const DEFAULT_APPEARANCE = {
  mode: "theme",
  mine: "#ea580c",
  theirs: "#f1f5f9",
  background: "#ffffff"
};

function isColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function readChatAppearance() {
  try {
    const parsed = JSON.parse(localStorage.getItem(scopedKey(STORAGE_KEY)) || "null");
    return normalizeChatAppearance(parsed);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveChatAppearance(value) {
  const next = normalizeChatAppearance(value);
  localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(next));
  globalThis.window?.dispatchEvent(new CustomEvent("enquote_chat_appearance_changed", { detail: next }));
  return next;
}

export function normalizeChatAppearance(value) {
  const hasLegacyColors = ["mine", "theirs", "background"].some((key) => isColor(value?.[key]));
  return {
    mode: value?.mode === "theme" ? "theme" : value?.mode === "custom" || hasLegacyColors ? "custom" : "theme",
    mine: isColor(value?.mine) ? value.mine : DEFAULT_APPEARANCE.mine,
    theirs: isColor(value?.theirs) ? value.theirs : DEFAULT_APPEARANCE.theirs,
    background: isColor(value?.background) ? value.background : DEFAULT_APPEARANCE.background
  };
}

export function resetChatAppearance() {
  localStorage.removeItem(scopedKey(STORAGE_KEY));
  const next = { ...DEFAULT_APPEARANCE };
  globalThis.window?.dispatchEvent(new CustomEvent("enquote_chat_appearance_changed", { detail: next }));
  return next;
}

export function onChatAppearanceChanged(callback) {
  const handler = (event) => callback(event.detail || readChatAppearance());
  globalThis.window?.addEventListener("enquote_chat_appearance_changed", handler);
  const offSession = onUserSessionChanged(() => callback(readChatAppearance()));
  return () => {
    globalThis.window?.removeEventListener("enquote_chat_appearance_changed", handler);
    offSession();
  };
}

export function readableTextColor(background) {
  return readableForegroundHex(isColor(background) ? background : "#ffffff");
}

export function chatAppearanceStyles(appearance) {
  if (appearance.mode === "theme") {
    return {
      background: {backgroundColor: "hsl(var(--background))", color: "hsl(var(--foreground))"},
      mine: {backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))"},
      theirs: {backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))"}
    };
  }
  return {
    background: {backgroundColor: appearance.background, color: readableTextColor(appearance.background)},
    mine: {backgroundColor: appearance.mine, color: readableTextColor(appearance.mine)},
    theirs: {backgroundColor: appearance.theirs, color: readableTextColor(appearance.theirs)}
  };
}
