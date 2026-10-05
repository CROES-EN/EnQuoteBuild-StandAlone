import {DEFAULT_THEME_ID, SYSTEM_THEME_ID, THEMES, isCustomThemeId} from "@/features/theme/themes";
import {scopedKey} from "@/lib/userScopedStorage";
import {DEFAULT_CUSTOM_COLORS, buildCustomTheme, normalizeCustomThemeSettings} from "@/features/theme/customThemeBuilder";

const STORAGE_KEY = "enquote_selected_theme_v1";
const CUSTOM_COLORS_STORAGE_KEY = "enquote_custom_theme_colors_v1";
const CUSTOM_THEMES_STORAGE_KEY = "enquote_custom_themes_v2";
const FOLLOW_SYSTEM_STORAGE_KEY = "enquote_follow_system_theme_v1";

function safeRead(key) {
  try {
    return localStorage.getItem(scopedKey(key));
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(scopedKey(key), value);
  } catch {
    // In-memory UI state still works if storage is unavailable.
  }
}

function makeCustomId() {
  return `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function getSavedThemeId() {
  const follow = getFollowSystemThemeSettings();
  if (follow.enabled) return SYSTEM_THEME_ID;
  const saved = safeRead(STORAGE_KEY);
  if (saved && (THEMES[saved] || isCustomThemeId(saved))) return saved;
  return DEFAULT_THEME_ID;
}

export function saveThemeId(themeId) {
  if (themeId === SYSTEM_THEME_ID) {
    saveFollowSystemThemeSettings({ ...getFollowSystemThemeSettings(), enabled: true });
    return;
  }
  saveFollowSystemThemeSettings({ ...getFollowSystemThemeSettings(), enabled: false });
  safeWrite(STORAGE_KEY, THEMES[themeId] || isCustomThemeId(themeId) ? themeId : DEFAULT_THEME_ID);
}

export function getSavedCustomColors() {
  const saved = safeRead(CUSTOM_COLORS_STORAGE_KEY);
  if (saved) {
    try {
      return normalizeCustomThemeSettings(JSON.parse(saved));
    } catch {
      // Fall through to defaults.
    }
  }
  return { ...DEFAULT_CUSTOM_COLORS };
}

export function saveCustomColors(colors) {
  safeWrite(CUSTOM_COLORS_STORAGE_KEY, JSON.stringify(normalizeCustomThemeSettings(colors)));
}

export function getSavedCustomThemes() {
  const saved = safeRead(CUSTOM_THEMES_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((theme) => theme && typeof theme.id === "string" && isCustomThemeId(theme.id))
          .map((theme) => ({ ...theme, settings: normalizeCustomThemeSettings(theme.settings || theme) }));
      }
    } catch {
      // Fall through to seeded legacy custom theme.
    }
  }
  return [{ id: "custom", settings: getSavedCustomColors() }];
}

export function saveCustomThemes(themes) {
  const normalized = themes.map((theme) => ({
    id: isCustomThemeId(theme.id) ? theme.id : makeCustomId(),
    settings: normalizeCustomThemeSettings(theme.settings || theme)
  }));
  if (!normalized.some((theme) => theme.id === "custom")) {
    normalized.unshift({ id: "custom", settings: getSavedCustomColors() });
  }
  safeWrite(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(normalized));
  const legacy = normalized.find((theme) => theme.id === "custom") || normalized[0];
  if (legacy) saveCustomColors(legacy.settings);
  return normalized;
}

export function upsertCustomTheme(theme) {
  const themes = getSavedCustomThemes();
  const id = theme.id || makeCustomId();
  const nextTheme = { id, settings: normalizeCustomThemeSettings(theme.settings || theme) };
  const next = themes.some((existing) => existing.id === id)
    ? themes.map((existing) => (existing.id === id ? nextTheme : existing))
    : [...themes, nextTheme];
  saveCustomThemes(next);
  return nextTheme;
}

export function deleteCustomTheme(customThemeId) {
  if (customThemeId === "custom") return getSavedCustomThemes();
  const next = getSavedCustomThemes().filter((theme) => theme.id !== customThemeId);
  return saveCustomThemes(next.length ? next : [{ id: "custom", settings: { ...DEFAULT_CUSTOM_COLORS } }]);
}

export function getCustomThemeById(themeId) {
  const themes = getSavedCustomThemes();
  return themes.find((theme) => theme.id === themeId) || themes.find((theme) => theme.id === "custom") || { id: "custom", settings: getSavedCustomColors() };
}

export function exportCustomTheme(themeId) {
  const theme = getCustomThemeById(themeId);
  return JSON.stringify({ version: 1, type: "enquote-theme", id: theme.id, settings: theme.settings }, null, 2);
}

export function importCustomTheme(json) {
  const parsed = JSON.parse(json);
  const settings = normalizeCustomThemeSettings(parsed.settings || parsed);
  return upsertCustomTheme({ id: parsed.id && isCustomThemeId(parsed.id) && parsed.id !== "custom" ? parsed.id : makeCustomId(), settings });
}

export function getFollowSystemThemeSettings() {
  const saved = safeRead(FOLLOW_SYSTEM_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        enabled: Boolean(parsed.enabled),
        lightThemeId: isThemeChoiceForMode(parsed.lightThemeId, false) ? parsed.lightThemeId : DEFAULT_THEME_ID,
        darkThemeId: isThemeChoiceForMode(parsed.darkThemeId, true) ? parsed.darkThemeId : "dark-plus"
      };
    } catch {
      // Fall through.
    }
  }
  return { enabled: false, lightThemeId: DEFAULT_THEME_ID, darkThemeId: "dark-plus" };
}

function isThemeChoiceForMode(themeId, isDark) {
  if (THEMES[themeId]) return Boolean(THEMES[themeId].isDark) === isDark;
  if (!isCustomThemeId(themeId)) return false;
  try {
    return buildCustomTheme(getCustomThemeById(themeId).settings).isDark === isDark;
  } catch {
    return false;
  }
}

export function saveFollowSystemThemeSettings(settings) {
  safeWrite(FOLLOW_SYSTEM_STORAGE_KEY, JSON.stringify({
    enabled: Boolean(settings.enabled),
    lightThemeId: isThemeChoiceForMode(settings.lightThemeId, false) ? settings.lightThemeId : DEFAULT_THEME_ID,
    darkThemeId: isThemeChoiceForMode(settings.darkThemeId, true) ? settings.darkThemeId : "dark-plus"
  }));
}
