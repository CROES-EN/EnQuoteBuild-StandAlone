import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_THEME_ID, THEMES, getTheme } from "@/features/theme/themes";
import { getSavedThemeId, saveThemeId, getSavedCustomColors } from "@/features/theme/themeStore";
import { onUserSessionChanged } from "@/lib/userScopedStorage";
import { buildCustomTheme } from "@/features/theme/customThemeBuilder";

const ThemeContext = createContext(null);

/**
 * Applies a theme by writing shadcn's OWN CSS variables (--background, --card, --foreground,
 * etc. - already defined in index.css and already consumed by every shadcn/ui component, e.g.
 * <Card>'s bg-card class) directly onto <html>, and toggling Tailwind's "dark" class based on
 * the theme's isDark flag (tailwind.config.js already has darkMode: ["class"] configured for
 * exactly this purpose).
 */
function applyThemeToDocument(themeId) {
  const theme = getTheme(themeId);
  const root = document.documentElement;

  // The "custom" theme has no static `variables`/`isDark` (both are empty placeholders in
  // themes.js) - both are computed here, live, from whatever 3 colors the user has
  // currently picked (see buildCustomTheme() in customThemeBuilder.js). This matters
  // because those colors can change at any time via ThemeSwitcher's color pickers, not
  // just when the user re-selects the "custom" theme itself.
  let variables = theme.variables;
  let isDark = theme.isDark;
  if (themeId === "custom") {
    const built = buildCustomTheme(getSavedCustomColors());
    variables = built.variables;
    isDark = built.isDark;
  }

  root.setAttribute("data-theme", theme.id);
  root.classList.toggle("dark", Boolean(isDark));

  Object.entries(variables).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

/**
 * Wrap the app with <ThemeProvider> once, near the root (see App.jsx). Everything else -
 * including the ThemeSwitcher dropdown - reads/writes the active theme through useTheme()
 * below rather than touching localStorage or the DOM directly.
 *
 * FIX (per explicit request - "reset theme to default as SOON as I'm signed out"): theme is
 * now per-signed-in-user (see themeStore.js), but this alone wasn't enough - the theme choice
 * was still only ever READ once, at initial mount, so switching WHO is signed in (a fresh
 * sign-in, or signing all the way out) had no immediate effect on what was visibly on screen
 * until something else happened to force a fresh read (e.g. a full page reload). Confirmed
 * live: signing out still showed the previous user's dark theme until a hard refresh. This
 * now subscribes to onUserSessionChanged() (fired by AuthContext.jsx on every sign-in AND
 * sign-out) and immediately re-reads/re-applies the CORRECT theme for whoever (if anyone) is
 * now signed in - the moment you sign out, this reads the theme for "nobody signed in" (the
 * anonymous namespace, which has no theme ever set) and instantly resets to
 * DEFAULT_THEME_ID, with no reload required.
 */
export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => getSavedThemeId());

  useEffect(() => {
    applyThemeToDocument(themeId);
    saveThemeId(themeId);
  }, [themeId]);

  // Re-reads the correct (per-user, or anonymous-default) theme the INSTANT the signed-in
  // identity changes, rather than waiting for a remount/reload to notice.
  useEffect(() => {
    const unsubscribe = onUserSessionChanged(() => {
      setThemeId(getSavedThemeId());
    });
    return unsubscribe;
  }, []);

    const value = {
    themeId,
    theme: getTheme(themeId),
    setThemeId,
    themes: Object.values(THEMES),
    // Re-applies the currently-active theme immediately using whatever custom colors are
    // NOW saved. Needed because changing a custom color while "custom" is already the
    // active theme does not change `themeId` itself (it is still "custom"), so the effect
    // above (which only re-runs when themeId changes) would not otherwise notice the
    // update - ThemeSwitcher calls this after saving a new color.
    refreshCustomTheme: () => applyThemeToDocument(themeId)
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    // Defensive fallback rather than throwing, in case a component using this hook ever renders
    // outside the provider during development - keeps the app usable with the default theme
    // instead of crashing the whole page.
    return {
      themeId: DEFAULT_THEME_ID,
      theme: getTheme(DEFAULT_THEME_ID),
      setThemeId: () => {},
      themes: Object.values(THEMES)
    };
  }
  return context;
}
