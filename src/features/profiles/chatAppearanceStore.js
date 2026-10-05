import {scopedKey, onUserSessionChanged} from "@/lib/userScopedStorage";

const STORAGE_KEY = "enquote_chat_appearance_v1";
const DEFAULT_APPEARANCE = {
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
    return {
      mine: isColor(parsed?.mine) ? parsed.mine : DEFAULT_APPEARANCE.mine,
      theirs: isColor(parsed?.theirs) ? parsed.theirs : DEFAULT_APPEARANCE.theirs,
      background: isColor(parsed?.background) ? parsed.background : DEFAULT_APPEARANCE.background
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveChatAppearance(value) {
  const next = {
    mine: isColor(value?.mine) ? value.mine : DEFAULT_APPEARANCE.mine,
    theirs: isColor(value?.theirs) ? value.theirs : DEFAULT_APPEARANCE.theirs,
    background: isColor(value?.background) ? value.background : DEFAULT_APPEARANCE.background
  };
  localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(next));
  globalThis.window?.dispatchEvent(new CustomEvent("enquote_chat_appearance_changed", { detail: next }));
  return next;
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
  const hex = isColor(background) ? background.slice(1) : "ffffff";
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const linear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.45 ? "#0f172a" : "#ffffff";
}
