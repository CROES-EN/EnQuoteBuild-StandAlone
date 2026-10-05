import {createContext, useContext, useEffect, useMemo, useState} from "react";
import {DEFAULT_THEME_ID, SYSTEM_THEME_ID, getTheme, isCustomThemeId, THEMES} from "@/features/theme/themes";
import {
  getCustomThemeById,
  getFollowSystemThemeSettings,
  getSavedThemeId,
  saveThemeId
} from "@/features/theme/themeStore";
import {onUserSessionChanged} from "@/lib/userScopedStorage";
import {buildCustomTheme} from "@/features/theme/customThemeBuilder";

const ThemeContext = createContext(null);

function resolveThemeId(themeId, prefersDark) {
  if (themeId !== SYSTEM_THEME_ID) return themeId;
  const settings = getFollowSystemThemeSettings();
  return prefersDark ? settings.darkThemeId : settings.lightThemeId;
}

function applyThemeToDocument(themeId, prefersDark = false) {
  const effectiveThemeId = resolveThemeId(themeId, prefersDark);
  const theme = getTheme(effectiveThemeId);
  const root = document.documentElement;
  let variables = theme.variables;
  let isDark = theme.isDark;
  let density = "comfortable";

  if (isCustomThemeId(effectiveThemeId)) {
    const savedCustom = getCustomThemeById(effectiveThemeId);
    const built = buildCustomTheme(savedCustom.settings);
    variables = built.variables;
    isDark = built.isDark;
    density = built.settings.density;
  }

  root.setAttribute("data-theme", effectiveThemeId);
  root.setAttribute("data-theme-density", density);
  root.classList.toggle("dark", Boolean(isDark));
  root.style.colorScheme = isDark ? "dark" : "light";

  Object.entries(variables).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });

  return effectiveThemeId;
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => getSavedThemeId());
  const [prefersDark, setPrefersDark] = useState(() => globalThis.window?.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false);
  const [customVersion, setCustomVersion] = useState(0);
  const effectiveThemeId = useMemo(() => resolveThemeId(themeId, prefersDark), [themeId, prefersDark, customVersion]);

  useEffect(() => {
    applyThemeToDocument(themeId, prefersDark);
    saveThemeId(themeId);
  }, [themeId, prefersDark, customVersion]);

  useEffect(() => {
    const query = globalThis.window?.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const handleChange = (event) => setPrefersDark(Boolean(event.matches));
    query.addEventListener?.("change", handleChange);
    query.addListener?.(handleChange);
    return () => {
      query.removeEventListener?.("change", handleChange);
      query.removeListener?.(handleChange);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onUserSessionChanged(() => {
      setThemeId(getSavedThemeId());
      setCustomVersion((version) => version + 1);
    });
    return unsubscribe;
  }, []);

  const value = {
    themeId,
    effectiveThemeId,
    theme: getTheme(effectiveThemeId),
    setThemeId,
    themes: Object.values(THEMES),
    followSystem: themeId === SYSTEM_THEME_ID,
    prefersDark,
    refreshCustomTheme: () => setCustomVersion((version) => version + 1)
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      themeId: DEFAULT_THEME_ID,
      effectiveThemeId: DEFAULT_THEME_ID,
      theme: getTheme(DEFAULT_THEME_ID),
      setThemeId: () => {},
      themes: Object.values(THEMES),
      followSystem: false,
      prefersDark: false,
      refreshCustomTheme: () => {}
    };
  }
  return context;
}
