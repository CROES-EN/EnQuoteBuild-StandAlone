/**
 * Persists the user's selected theme choice to localStorage. Deliberately simple and separate
 * from every other data store in this app (opsMetricsStore.js, importedTableStore.js, etc.) -
 * this is a pure UI preference, not operational data, so it never touches the Electron-bridge
 * collections API and works identically in both the desktop app and a plain browser tab.
 *
 * FIX (per explicit request - "make sure theme settings are per user"): this previously stored
 * the theme under ONE fixed key shared by everyone signed in on the same PC. Now uses
 * userScopedStorage.js's scopedKey() to namespace the storage key by the CURRENTLY SIGNED-IN
 * user, so each person's theme choice is fully independent, even on a shared PC.
 *
 * v2 FIX: the first version of this fix ALSO auto-migrated the old, shared unscoped value
 * forward into any new user's scoped slot the first time it was read - this was found to be a
 * real bug, confirmed live: signing in as a second person (Kim) on the same PC silently
 * inherited the FIRST person's (Carsten's) previously-set theme, since nothing distinguishes
 * "this is genuinely the same returning person" from "this is someone new reading the old
 * shared key for the first time." Automatic migration has been removed entirely - every user
 * now correctly starts from DEFAULT_THEME_ID until they personally pick their own theme, with
 * zero risk of inheriting a different person's prior choice. The one-time cost: anyone who had
 * already set a theme before this fix shipped will need to re-pick it once - a trivial,
 * one-click action, and a small price for eliminating a real identity-leak bug.
 */

import { DEFAULT_THEME_ID, THEMES } from "@/features/theme/themes";
import { scopedKey } from "@/lib/userScopedStorage";
import { DEFAULT_CUSTOM_COLORS } from "@/features/theme/customThemeBuilder";

const STORAGE_KEY = "enquote_selected_theme_v1";

export function getSavedThemeId() {
  try {
    const saved = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (saved && THEMES[saved]) return saved;
  } catch {
    // localStorage unavailable (e.g. some restricted contexts) - fall back to default silently.
  }
  return DEFAULT_THEME_ID;
}

export function saveThemeId(themeId) {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), themeId);
  } catch {
    // Ignore write failures - the in-memory selection still works for this session.
  }
}

// Per-user storage for the 3 colors behind the "custom" theme (see customThemeBuilder.js
// for how these are turned into a full theme). Uses the exact same scopedKey() pattern as
// the theme choice above, for the same reason - each signed-in user's custom colors must
// be fully independent, with zero risk of one person's picks leaking into another's
// session (see the v2 fix note at the top of this file for why NO automatic migration of
// old/shared values is ever performed - the same reasoning applies here).
const CUSTOM_COLORS_STORAGE_KEY = "enquote_custom_theme_colors_v1";

export function getSavedCustomColors() {
  try {
    const saved = localStorage.getItem(scopedKey(CUSTOM_COLORS_STORAGE_KEY));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        typeof parsed.background === "string" &&
        typeof parsed.sidebar === "string" &&
        typeof parsed.primary === "string"
      ) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse/storage errors - fall back to sensible defaults below.
  }
  return { ...DEFAULT_CUSTOM_COLORS };
}

export function saveCustomColors(colors) {
  try {
    localStorage.setItem(scopedKey(CUSTOM_COLORS_STORAGE_KEY), JSON.stringify(colors));
  } catch {
    // Ignore write failures - the in-memory selection still works for this session.
  }
}
