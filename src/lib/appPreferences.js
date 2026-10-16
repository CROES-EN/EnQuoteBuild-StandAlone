import {scopedKey} from "./userScopedStorage";

export const APP_PREFERENCES_KEY = "enquote_app_preferences_v1";
export const APP_PREFERENCES_CHANGED = "enquote_app_preferences_changed";

export function normalizeAppPreferences(value) {
  return {
    salesforceMode: value?.salesforceMode === "external" ? "external" : "workspace",
    showSalesforceLauncher: value?.showSalesforceLauncher !== false,
    salesforcePanelExpanded: value?.salesforcePanelExpanded !== false,
    salesforcePanelWidth: Number.isFinite(value?.salesforcePanelWidth)
      ? Math.max(320, Math.min(1600, value.salesforcePanelWidth)) : 960,
    hiddenPages: Array.isArray(value?.hiddenPages)
      ? [...new Set(value.hiddenPages.filter(page => typeof page === "string" && page !== "Settings"))]
      : []
  };
}

export function readAppPreferences(storage = globalThis.localStorage) {
  try {
    return normalizeAppPreferences(JSON.parse(storage.getItem(scopedKey(APP_PREFERENCES_KEY)) || "null"));
  } catch (error) {
    console.warn("[app-preferences] Could not read preferences:", error);
    return normalizeAppPreferences(null);
  }
}

export function writeAppPreferences(value, storage = globalThis.localStorage) {
  const preferences = normalizeAppPreferences(value);
  storage.setItem(scopedKey(APP_PREFERENCES_KEY), JSON.stringify(preferences));
  globalThis.window?.dispatchEvent(new Event(APP_PREFERENCES_CHANGED));
  return preferences;
}

export function filterSidebarItems(items, preferences) {
  return items.filter(item => item.page === "Settings" || !preferences.hiddenPages.includes(item.page));
}
