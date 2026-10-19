import {scopedKey} from "./userScopedStorage";

export const pageViewKey = (page, field) => scopedKey(`enquote_view_v1:${page}:${field}`);

function revive(_key, value) {
  if (value && typeof value === "object" && value.type === "selected-values" && Array.isArray(value.values)) {
    if (!value.values.every(item => typeof item === "string")) throw new Error("Invalid column filter values.");
    return new Set(value.values);
  }
  return value;
}

export function readPageView(key, fallback) {
  try {
    const raw = globalThis.window?.localStorage?.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw, revive);
    const valid = fallback === null ? value === null || typeof value === "string"
      : Array.isArray(fallback) ? Array.isArray(value) && value.every(item => typeof item === "string")
        : typeof fallback === "object" ? value && !Array.isArray(value) && typeof value === "object" &&
          Object.values(value).every(item => item instanceof Set)
          : typeof value === typeof fallback;
    if (!valid) throw new Error("Invalid saved view setting.");
    return value;
  } catch (error) {
    console.warn("[page-view] Could not restore view setting:", error);
    return fallback;
  }
}

export function writePageView(key, value) {
  try {
    globalThis.window?.localStorage?.setItem(key, JSON.stringify(value, (_key, item) =>
      item instanceof Set ? {type: "selected-values", values: [...item]} : item));
  } catch (error) {
    console.warn("[page-view] Could not save view setting; it may reset after navigation:", error);
  }
}
