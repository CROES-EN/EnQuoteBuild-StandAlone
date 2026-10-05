import {buildPresetTheme} from "@/features/theme/customThemeBuilder";

function preset({ id, name, description, mode, background, sidebar, primary, accent, radius = 0.5, previewColors }) {
  const built = buildPresetTheme({ mode, background, sidebar, primary, accent, radius });
  return {
    id,
    name,
    description,
    isDark: built.isDark,
    previewColors: previewColors || built.previewColors,
    variables: built.variables
  };
}

export const THEMES = {
  "light-plus": preset({
    id: "light-plus",
    name: "Light+ (Default)",
    description: "Clean bright workspace with EnQuote indigo accents.",
    mode: "light",
    background: "#f8fafc",
    sidebar: "#ffffff",
    primary: "#4f46e5",
    accent: "#0ea5e9",
    radius: 0.5,
    previewColors: ["#f8fafc", "#ffffff", "#4f46e5"]
  }),
  "dark-plus": preset({
    id: "dark-plus",
    name: "Dark+",
    description: "Balanced VS Code-style dark theme with clear blue focus.",
    mode: "dark",
    background: "#1e1e1e",
    sidebar: "#252526",
    primary: "#007acc",
    accent: "#22d3ee",
    radius: 0.5,
    previewColors: ["#1e1e1e", "#252526", "#007acc"]
  }),
  monokai: preset({
    id: "monokai",
    name: "Monokai",
    description: "Warm dark editor palette with crisp lime and pink accents.",
    mode: "dark",
    background: "#272822",
    sidebar: "#1f201b",
    primary: "#a6e22e",
    accent: "#f92672",
    radius: 0.55,
    previewColors: ["#272822", "#3e3d32", "#f92672"]
  }),
  "solarized-dark": preset({
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Low-glare teal shadows with readable blue highlights.",
    mode: "dark",
    background: "#002b36",
    sidebar: "#073642",
    primary: "#268bd2",
    accent: "#2aa198",
    radius: 0.55,
    previewColors: ["#002b36", "#073642", "#268bd2"]
  }),
  purple: preset({
    id: "purple",
    name: "Mackey Purple",
    description: "Polished violet surfaces with a strong branded sidebar.",
    mode: "light",
    background: "#f4edff",
    sidebar: "#32115f",
    primary: "#7c1fd6",
    accent: "#a855f7",
    radius: 0.65,
    previewColors: ["#f4edff", "#32115f", "#7c1fd6"]
  }),
  "rose-gold": preset({
    id: "rose-gold",
    name: "Rose Gold",
    description: "Soft blush workspace with warm rose-gold controls.",
    mode: "light",
    background: "#fff5f8",
    sidebar: "#5d2035",
    primary: "#be476d",
    accent: "#d97757",
    radius: 0.75,
    previewColors: ["#fff5f8", "#5d2035", "#be476d"]
  }),
  "midnight-slate": preset({
    id: "midnight-slate",
    name: "Midnight Slate",
    description: "Deep navy slate with electric blue emphasis.",
    mode: "dark",
    background: "#0f172a",
    sidebar: "#020617",
    primary: "#3b82f6",
    accent: "#14b8a6",
    radius: 0.65,
    previewColors: ["#0f172a", "#020617", "#3b82f6"]
  }),
  "forest-green": preset({
    id: "forest-green",
    name: "Forest Green",
    description: "Sage-tinted light theme with a grounded forest sidebar.",
    mode: "light",
    background: "#f2f8f1",
    sidebar: "#123524",
    primary: "#187047",
    accent: "#6a994e",
    radius: 0.7,
    previewColors: ["#f2f8f1", "#123524", "#187047"]
  }),
  rainbow: preset({
    id: "rainbow",
    name: "Rainbow",
    description: "Bright playful palette, toned for readable everyday use.",
    mode: "light",
    background: "#f0fdff",
    sidebar: "#86198f",
    primary: "#65a30d",
    accent: "#d97706",
    radius: 0.8,
    previewColors: ["#f0fdff", "#86198f", "#d97706"]
  }),
  "slate": preset({
    id: "slate",
    name: "Slate",
    description: "Neutral light theme for long quoting sessions.",
    mode: "light",
    background: "#f8fafc",
    sidebar: "#e2e8f0",
    primary: "#334155",
    accent: "#2563eb",
    radius: 0.55,
    previewColors: ["#f8fafc", "#e2e8f0", "#334155"]
  }),
  midnight: preset({
    id: "midnight",
    name: "Midnight",
    description: "Near-black command center with violet-blue highlights.",
    mode: "dark",
    background: "#080b16",
    sidebar: "#0b1020",
    primary: "#818cf8",
    accent: "#38bdf8",
    radius: 0.65,
    previewColors: ["#080b16", "#0b1020", "#818cf8"]
  }),
  "forest-dark": preset({
    id: "forest-dark",
    name: "Forest Dark",
    description: "Dark evergreen workspace with mint call-to-action states.",
    mode: "dark",
    background: "#07130d",
    sidebar: "#0d1f16",
    primary: "#34d399",
    accent: "#a3e635",
    radius: 0.7,
    previewColors: ["#07130d", "#0d1f16", "#34d399"]
  }),
  sunset: preset({
    id: "sunset",
    name: "Sunset",
    description: "Warm cream surfaces with terracotta and amber accents.",
    mode: "light",
    background: "#fff7ed",
    sidebar: "#7c2d12",
    primary: "#c2410c",
    accent: "#d97706",
    radius: 0.75,
    previewColors: ["#fff7ed", "#7c2d12", "#c2410c"]
  }),
  "high-contrast": preset({
    id: "high-contrast",
    name: "High Contrast",
    description: "Maximum separation for dim rooms, projectors, and accessibility.",
    mode: "dark",
    background: "#000000",
    sidebar: "#000000",
    primary: "#facc15",
    accent: "#22d3ee",
    radius: 0.35,
    previewColors: ["#000000", "#111827", "#facc15"]
  }),
  custom: {
    id: "custom",
    name: "Custom",
    description: "Saved custom themes with automatic accessible foregrounds.",
    isDark: false,
    previewColors: ["#f8fafc", "#1e1e2e", "#4f46e5"],
    variables: {}
  }
};

export const THEME_LIST = Object.values(THEMES);
export const DEFAULT_THEME_ID = "light-plus";
export const SYSTEM_THEME_ID = "system";

export function isCustomThemeId(themeId) {
  return themeId === "custom" || String(themeId || "").startsWith("custom:");
}

export function getTheme(themeId) {
  if (isCustomThemeId(themeId)) return THEMES.custom;
  return THEMES[themeId] || THEMES[DEFAULT_THEME_ID];
}
