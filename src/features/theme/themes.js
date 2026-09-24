/**
 * EnQuote theme definitions, styled after popular VS Code color themes.
 *
 * CORRECTED APPROACH (v2): rather than maintaining a second, parallel set of CSS variables
 * that only intercepts raw Tailwind classes (bg-white, text-slate-900), this drives shadcn's
 * OWN existing HSL CSS-variable system directly (--background, --card, --foreground, etc. -
 * already defined in index.css and already wired into tailwind.config.js's darkMode: ["class"]
 * setup). This is the system shadcn/ui components like <Card> (which uses bg-card) already
 * read from, so setting these variables re-themes EVERY shadcn component automatically,
 * without needing a second override stylesheet chasing individual utility classes.
 *
 * Values are in shadcn's expected format: "H S% L%" (space-separated, no hsl() wrapper - Tailwind's
 * config already wraps these as hsl(var(--background)) etc.).
 *
 * "light-plus" matches the app's ORIGINAL index.css :root values exactly - selecting it produces
 * zero visual change from how the app looked before this feature existed.
 *
 * "dark-plus", "monokai", "solarized-dark", and "solarized-light" also set isDark, which
 * ThemeContext.jsx uses to toggle Tailwind's "dark" class on <html> - required because several
 * of index.css's existing dark-mode values (in the .dark block) differ structurally from
 * :root's, and toggling the class ensures any component relying on Tailwind's dark: variant
 * (not just CSS variables) also responds correctly.
 */

export const THEMES = {
  "light-plus": {
    id: "light-plus",
    name: "Light+ (Default)",
    description: "The app's original look - clean white background.",
    isDark: false,
    previewColors: ["#ffffff", "#f8fafc", "#4f46e5"],
    variables: {
      "--background": "210 20% 98%",
      "--foreground": "0 0% 3.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "0 0% 3.9%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "0 0% 3.9%",
      "--primary": "243 75% 59%",
      "--primary-foreground": "0 0% 98%",
      "--secondary": "0 0% 96.1%",
      "--secondary-foreground": "0 0% 9%",
      "--muted": "0 0% 96.1%",
      "--muted-foreground": "0 0% 45.1%",
      "--accent": "0 0% 96.1%",
      "--accent-foreground": "0 0% 9%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "0 0% 89.8%",
      "--input": "0 0% 89.8%",
      "--ring": "243 75% 59%",
      "--sidebar-background": "0 0% 100%",
      "--sidebar-foreground": "240 5.3% 26.1%",
      "--sidebar-primary": "240 5.9% 10%",
      "--sidebar-primary-foreground": "0 0% 98%",
      "--sidebar-accent": "240 4.8% 95.9%",
      "--sidebar-accent-foreground": "240 5.9% 10%",
      "--sidebar-border": "220 13% 91%",
      "--sidebar-ring": "217.2 91.2% 59.8%"
    }
  },

  "dark-plus": {
    id: "dark-plus",
    name: "Dark+",
    description: "VS Code's iconic default dark theme.",
    isDark: true,
    previewColors: ["#1e1e1e", "#252526", "#007acc"],
    variables: {
      "--background": "0 0% 12%",
      "--foreground": "0 0% 83%",
      "--card": "0 0% 15%",
      "--card-foreground": "0 0% 83%",
      "--popover": "0 0% 15%",
      "--popover-foreground": "0 0% 83%",
      "--primary": "201 100% 40%",
      "--primary-foreground": "0 0% 98%",
      "--secondary": "0 0% 18%",
      "--secondary-foreground": "0 0% 83%",
      "--muted": "0 0% 18%",
      "--muted-foreground": "0 0% 63%",
      "--accent": "0 0% 20%",
      "--accent-foreground": "0 0% 90%",
      "--destructive": "0 62.8% 40%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "0 0% 24%",
      "--input": "0 0% 24%",
      "--ring": "201 100% 40%",
      "--sidebar-background": "0 0% 15%",
      "--sidebar-foreground": "0 0% 83%",
      "--sidebar-primary": "201 100% 40%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent": "0 0% 20%",
      "--sidebar-accent-foreground": "0 0% 90%",
      "--sidebar-border": "0 0% 24%",
      "--sidebar-ring": "201 100% 40%"
    }
  },

  "monokai": {
    id: "monokai",
    name: "Monokai",
    description: "Warm, high-contrast dark theme with vivid accents.",
    isDark: true,
    previewColors: ["#272822", "#3e3d32", "#f92672"],
    variables: {
      "--background": "70 4% 15%",
      "--foreground": "60 30% 96%",
      "--card": "68 6% 18%",
      "--card-foreground": "60 30% 96%",
      "--popover": "68 6% 18%",
      "--popover-foreground": "60 30% 96%",
      "--primary": "80 76% 53%",
      "--primary-foreground": "70 4% 10%",
      "--secondary": "60 5% 24%",
      "--secondary-foreground": "60 30% 96%",
      "--muted": "60 5% 24%",
      "--muted-foreground": "60 5% 62%",
      "--accent": "338 95% 56%",
      "--accent-foreground": "60 30% 96%",
      "--destructive": "338 95% 56%",
      "--destructive-foreground": "60 30% 96%",
      "--border": "60 6% 28%",
      "--input": "60 6% 28%",
      "--ring": "80 76% 53%",
      "--sidebar-background": "70 4% 16%",
      "--sidebar-foreground": "60 30% 96%",
      "--sidebar-primary": "80 76% 53%",
      "--sidebar-primary-foreground": "70 4% 10%",
      "--sidebar-accent": "60 5% 24%",
      "--sidebar-accent-foreground": "60 30% 96%",
      "--sidebar-border": "60 6% 28%",
      "--sidebar-ring": "80 76% 53%"
    }
  },

  "solarized-dark": {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Low-contrast, precision-tuned dark theme, easy on the eyes.",
    isDark: true,
    previewColors: ["#002b36", "#073642", "#268bd2"],
    variables: {
      "--background": "193 100% 11%",
      "--foreground": "44 87% 94%",
      "--card": "192 81% 14%",
      "--card-foreground": "44 87% 94%",
      "--popover": "192 81% 14%",
      "--popover-foreground": "44 87% 94%",
      "--primary": "205 69% 49%",
      "--primary-foreground": "44 87% 94%",
      "--secondary": "192 66% 17%",
      "--secondary-foreground": "44 87% 94%",
      "--muted": "192 66% 17%",
      "--muted-foreground": "186 8% 55%",
      "--accent": "192 66% 19%",
      "--accent-foreground": "44 87% 94%",
      "--destructive": "1 71% 52%",
      "--destructive-foreground": "44 87% 94%",
      "--border": "192 60% 22%",
      "--input": "192 60% 22%",
      "--ring": "205 69% 49%",
      "--sidebar-background": "192 81% 13%",
      "--sidebar-foreground": "44 87% 94%",
      "--sidebar-primary": "205 69% 49%",
      "--sidebar-primary-foreground": "44 87% 94%",
      "--sidebar-accent": "192 66% 17%",
      "--sidebar-accent-foreground": "44 87% 94%",
      "--sidebar-border": "192 60% 22%",
      "--sidebar-ring": "205 69% 49%"
    }
  },

  
  "purple": {
    id: "purple",
    name: "Mackey Purple",
    description: "A vibrant violet theme with a bold sidebar and tinted surfaces throughout.",
    isDark: false,
    previewColors: ["#ede4ff", "#d9c7ff", "#7c1fd6"],
    variables: {
      "--background": "270 45% 95%",
      "--foreground": "271 60% 14%",
      "--card": "270 40% 98%",
      "--card-foreground": "271 60% 14%",
      "--popover": "270 40% 98%",
      "--popover-foreground": "271 60% 14%",
      "--primary": "271 91% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "270 45% 90%",
      "--secondary-foreground": "271 60% 20%",
      "--muted": "270 40% 91%",
      "--muted-foreground": "271 25% 38%",
      "--accent": "271 91% 45%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "270 35% 80%",
      "--input": "270 35% 80%",
      "--ring": "271 91% 45%",
      "--sidebar-background": "271 70% 20%",
      "--sidebar-foreground": "270 60% 96%",
      "--sidebar-primary": "271 91% 65%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent": "271 60% 30%",
      "--sidebar-accent-foreground": "0 0% 100%",
      "--sidebar-border": "271 50% 28%",
      "--sidebar-ring": "271 91% 65%"
    }
  },
  "rose-gold": {
    id: "rose-gold",
    name: "Rose Gold",
    description: "A warm, elegant dusty-rose theme with a soft blush background.",
    isDark: false,
    previewColors: ["#fdf4f7", "#f9e7ee", "#8b3f5b"],
    variables: {
      "--background": "340 45% 97%",
      "--foreground": "340 30% 15%",
      "--card": "0 0% 100%",
      "--card-foreground": "340 30% 15%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "340 30% 15%",
      "--primary": "340 65% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "340 35% 92%",
      "--secondary-foreground": "340 30% 20%",
      "--muted": "340 30% 93%",
      "--muted-foreground": "340 15% 40%",
      "--accent": "340 65% 45%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "340 30% 85%",
      "--input": "340 30% 85%",
      "--ring": "340 65% 45%",
      "--sidebar-background": "345 45% 22%",
      "--sidebar-foreground": "340 40% 95%",
      "--sidebar-primary": "340 70% 60%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent": "345 35% 32%",
      "--sidebar-accent-foreground": "340 40% 95%",
      "--sidebar-border": "345 35% 28%",
      "--sidebar-ring": "340 70% 60%"
    }
  },
  "midnight-slate": {
    id: "midnight-slate",
    name: "Midnight Slate",
    description: "A sleek, modern dark theme with deep navy tones and an electric blue accent.",
    isDark: true,
    previewColors: ["#0f172a", "#1e293b", "#3b82f6"],
    variables: {
      "--background": "222 47% 8%",
      "--foreground": "210 40% 92%",
      "--card": "222 40% 11%",
      "--card-foreground": "210 40% 92%",
      "--popover": "222 40% 11%",
      "--popover-foreground": "210 40% 92%",
      "--primary": "217 91% 60%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "222 30% 16%",
      "--secondary-foreground": "210 40% 92%",
      "--muted": "222 30% 16%",
      "--muted-foreground": "215 20% 65%",
      "--accent": "217 91% 60%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 62.8% 45%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "222 25% 20%",
      "--input": "222 25% 20%",
      "--ring": "217 91% 60%",
      "--sidebar-background": "222 47% 6%",
      "--sidebar-foreground": "210 40% 90%",
      "--sidebar-primary": "217 91% 60%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent": "222 30% 16%",
      "--sidebar-accent-foreground": "210 40% 90%",
      "--sidebar-border": "222 25% 18%",
      "--sidebar-ring": "217 91% 60%"
    }
  },
  "forest-green": {
    id: "forest-green",
    name: "Forest Green",
    description: "A calm, natural theme with a deep forest-green sidebar and sage-tinted background.",
    isDark: false,
    previewColors: ["#f2f8f1", "#cfe9c7", "#0f5132"],
    variables: {
      "--background": "110 25% 96%",
      "--foreground": "150 30% 12%",
      "--card": "0 0% 100%",
      "--card-foreground": "150 30% 12%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "150 30% 12%",
      "--primary": "145 55% 30%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "110 25% 92%",
      "--secondary-foreground": "150 30% 15%",
      "--muted": "110 20% 92%",
      "--muted-foreground": "150 15% 40%",
      "--accent": "100 40% 42%",
      "--accent-foreground": "0 0% 100%",
      "--destructive": "0 84.2% 60.2%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "110 20% 85%",
      "--input": "110 20% 85%",
      "--ring": "145 55% 30%",
      "--sidebar-background": "150 45% 14%",
      "--sidebar-foreground": "110 30% 92%",
      "--sidebar-primary": "100 40% 55%",
      "--sidebar-primary-foreground": "150 45% 10%",
      "--sidebar-accent": "150 35% 24%",
      "--sidebar-accent-foreground": "110 30% 92%",
      "--sidebar-border": "150 30% 22%",
      "--sidebar-ring": "100 40% 55%"
    }
  },
  "rainbow": {
    id: "rainbow",
    name: "Rainbow",
    description: "A maximalist, loud multi-color palette - hot magenta, electric lime, and golden yellow, all at once, on purpose.",
    isDark: false,
    previewColors: ["#ff2ec4", "#a3ff12", "#ffd60a"],
    variables: {
      "--background": "185 90% 95%",
      "--foreground": "320 70% 15%",
      "--card": "0 0% 100%",
      "--card-foreground": "320 70% 15%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "320 70% 15%",
      "--primary": "88 95% 50%",
      "--primary-foreground": "320 70% 12%",
      "--secondary": "185 85% 88%",
      "--secondary-foreground": "320 70% 15%",
      "--muted": "185 60% 90%",
      "--muted-foreground": "320 30% 30%",
      "--accent": "48 100% 55%",
      "--accent-foreground": "320 70% 12%",
      "--destructive": "0 90% 55%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "330 90% 70%",
      "--input": "330 90% 70%",
      "--ring": "88 95% 50%",
      "--sidebar-background": "322 90% 45%",
      "--sidebar-foreground": "0 0% 100%",
      "--sidebar-primary": "48 100% 55%",
      "--sidebar-primary-foreground": "320 70% 12%",
      "--sidebar-accent": "88 95% 50%",
      "--sidebar-accent-foreground": "320 70% 12%",
      "--sidebar-border": "322 80% 35%",
            "--sidebar-ring": "48 100% 55%"
    }
  },

  "custom": {
    id: "custom",
    name: "Custom",
    description: "Pick your own 3 colors - everything else is generated to stay readable.",
    // isDark/variables here are placeholder defaults only - ThemeContext.jsx computes the
    // REAL values at apply-time from whatever colors are currently saved (see
    // buildCustomTheme() in customThemeBuilder.js), since those can change at any moment
    // (via ThemeSwitcher's color pickers) independently of ever re-selecting this theme.
    isDark: false,
    previewColors: ["#f8fafc", "#1e1e2e", "#4f46e5"],
    variables: {}
  }
};

export const THEME_LIST = Object.values(THEMES);

export const DEFAULT_THEME_ID = "light-plus";

export function getTheme(themeId) {
  return THEMES[themeId] || THEMES[DEFAULT_THEME_ID];
}

