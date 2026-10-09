const AA_CONTRAST = 4.5;

const ACTION_COLORS = {
  red: "#b91c1c", rose: "#be123c", yellow: "#a16207", amber: "#b45309",
  orange: "#c2410c", green: "#15803d", emerald: "#047857", teal: "#0f766e",
  cyan: "#0e7490", sky: "#0369a1", blue: "#1d4ed8", purple: "#7e22ce",
  violet: "#6d28d9", fuchsia: "#a21caf", pink: "#be185d", lime: "#4d7c0f"
};

export const DENSITY_OPTIONS = {
  comfortable: { label: "Comfortable", scale: 1, fontScale: 1 },
  cozy: { label: "Cozy", scale: 0.94, fontScale: 0.98 },
  compact: { label: "Compact", scale: 0.88, fontScale: 0.95 }
};

export const DEFAULT_CUSTOM_COLORS = {
  name: "My Theme",
  mode: "light",
  backgroundTint: "#f8fafc",
  background: "#f8fafc",
  sidebar: "#1e1e2e",
  primary: "#4f46e5",
  accent: "#0ea5e9",
  radius: 0.65,
  density: "comfortable",
  fontScale: 1
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function clampPercent(value) {
  return clamp(value, 0, 100);
}

export function normalizeHex(hex, fallback = "#000000") {
  const cleaned = String(hex || "").trim().replace(/^#/, "");
  const expanded = cleaned.length === 3 ? cleaned.split("").map((char) => char + char).join("") : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return fallback;
  return `#${expanded.toLowerCase()}`;
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((part) => clamp(Math.round(part), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl({ r, g, b }) {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case red:
        h = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
        break;
      case green:
        h = ((blue - red) / delta + 2) * 60;
        break;
      default:
        h = ((red - green) / delta + 4) * 60;
        break;
    }
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHsl(hex) {
  return rgbToHsl(hexToRgb(hex));
}

export function hslToRgb({ h, s, l }) {
  const hue = (((Number(h) || 0) % 360) + 360) % 360;
  const sat = clampPercent(Number(s) || 0) / 100;
  const light = clampPercent(Number(l) || 0) / 100;

  if (sat === 0) {
    const value = Math.round(light * 255);
    return { r: value, g: value, b: value };
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const hueToRgb = (t) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const normalizedHue = hue / 360;
  return {
    r: Math.round(hueToRgb(normalizedHue + 1 / 3) * 255),
    g: Math.round(hueToRgb(normalizedHue) * 255),
    b: Math.round(hueToRgb(normalizedHue - 1 / 3) * 255)
  };
}

export function hslToHex(hsl) {
  return rgbToHex(hslToRgb(hsl));
}

export function hslToVarString({ h, s, l }) {
  return `${Math.round((((Number(h) || 0) % 360) + 360) % 360)} ${Math.round(clampPercent(Number(s) || 0))}% ${Math.round(clampPercent(Number(l) || 0))}%`;
}

export function parseHslVar(value) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
  if (!match) return { h: 0, s: 0, l: 0 };
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

export function relativeLuminance(input) {
  const { r, g, b } = typeof input === "string" ? hexToRgb(input) : input;
  const channel = (value) => {
    const normalized = clamp(value, 0, 255) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(colorA, colorB) {
  const first = relativeLuminance(colorA);
  const second = relativeLuminance(colorB);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableForegroundHex(backgroundHex, minimum = AA_CONTRAST) {
  const dark = "#111827";
  const light = "#f8fafc";
  const darkContrast = contrastRatio(backgroundHex, dark);
  const lightContrast = contrastRatio(backgroundHex, light);
  const best = darkContrast >= lightContrast ? dark : light;
  if (Math.max(darkContrast, lightContrast) >= minimum) return best;
  return contrastRatio(backgroundHex, "#000000") >= contrastRatio(backgroundHex, "#ffffff") ? "#000000" : "#ffffff";
}

export function readableForegroundHsl(backgroundHsl, minimum = AA_CONTRAST) {
  return hexToHsl(readableForegroundHex(hslToHex(backgroundHsl), minimum));
}

function toneFrom(base, lightness, saturationCap = 100) {
  return { h: base.h, s: Math.min(base.s, saturationCap), l: clampPercent(lightness) };
}

function readableAccentText(color, surfaces, isDark, minimum = AA_CONTRAST) {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = toneFrom(color, Math.round(color.l + ((isDark ? 100 : 0) - color.l) * step / 100));
    if (surfaces.every(surface => contrastRatio(hslToHex(candidate), hslToHex(surface)) >= minimum)) {
      return candidate;
    }
  }
  return { h: 0, s: 0, l: isDark ? 100 : 0 };
}

function hoverTone(background, foreground) {
  return toneFrom(background, background.l + (relativeLuminance(hslToHex(foreground)) > 0.5 ? -4 : 4));
}

function modeFromSettings(settings) {
  if (settings.mode === "dark" || settings.mode === "light") return settings.mode;
  const source = settings.backgroundTint || settings.background || DEFAULT_CUSTOM_COLORS.backgroundTint;
  return hexToHsl(source).l < 50 ? "dark" : "light";
}

export function normalizeCustomThemeSettings(settings = {}) {
  const mode = modeFromSettings(settings);
  const density = DENSITY_OPTIONS[settings.density] ? settings.density : DEFAULT_CUSTOM_COLORS.density;
  const fontScale = clamp(Number(settings.fontScale ?? DENSITY_OPTIONS[density].fontScale), 0.9, 1.12);
  return {
    name: String(settings.name || DEFAULT_CUSTOM_COLORS.name).slice(0, 48),
    mode,
    backgroundTint: normalizeHex(settings.backgroundTint || settings.background || DEFAULT_CUSTOM_COLORS.backgroundTint, DEFAULT_CUSTOM_COLORS.backgroundTint),
    sidebar: normalizeHex(settings.sidebar || DEFAULT_CUSTOM_COLORS.sidebar, DEFAULT_CUSTOM_COLORS.sidebar),
    primary: normalizeHex(settings.primary || DEFAULT_CUSTOM_COLORS.primary, DEFAULT_CUSTOM_COLORS.primary),
    accent: normalizeHex(settings.accent || settings.primary || DEFAULT_CUSTOM_COLORS.accent, DEFAULT_CUSTOM_COLORS.accent),
    radius: clamp(Number(settings.radius ?? DEFAULT_CUSTOM_COLORS.radius), 0, 1.5),
    density,
    fontScale
  };
}

export function buildPresetTheme({ mode = "light", background, sidebar, primary, accent, radius = 0.5, density = "comfortable", fontScale } = {}) {
  return buildCustomTheme({
    mode,
    backgroundTint: background,
    sidebar,
    primary,
    accent: accent || primary,
    radius,
    density,
    fontScale
  });
}

export function buildCustomTheme(settings = {}) {
  const normalized = normalizeCustomThemeSettings(settings);
  const isDark = normalized.mode === "dark";
  const tint = hexToHsl(normalized.backgroundTint);
  const sidebarPick = hexToHsl(normalized.sidebar);
  const primary = hexToHsl(normalized.primary);
  const accent = hexToHsl(normalized.accent);

  const background = toneFrom(tint, isDark ? clamp(tint.l, 6, 14) : clamp(tint.l, 94, 99), isDark ? 35 : 28);
  const foreground = readableForegroundHsl(background);
  const card = toneFrom(background, isDark ? background.l + 4 : Math.max(98, background.l + 1), isDark ? 30 : 18);
  const popover = toneFrom(background, isDark ? background.l + 5 : 100, isDark ? 32 : 18);
  const secondary = toneFrom(background, isDark ? background.l + 9 : background.l - 5, isDark ? 24 : 22);
  const muted = toneFrom(background, isDark ? background.l + 10 : background.l - 4, isDark ? 18 : 16);
  const border = toneFrom(background, isDark ? background.l + 16 : background.l - 13, isDark ? 22 : 18);
  const mutedForeground = toneFrom(foreground, isDark ? 70 : 37, 10);

  const sidebar = toneFrom(sidebarPick, isDark ? clamp(sidebarPick.l, 5, 18) : (sidebarPick.l < 50 ? clamp(sidebarPick.l, 12, 26) : clamp(sidebarPick.l, 94, 99)), isDark ? 38 : 45);
  const sidebarForeground = readableForegroundHsl(sidebar);
  const sidebarAccent = toneFrom(sidebar, sidebar.l < 50 ? sidebar.l + 12 : sidebar.l - 8, sidebar.s < 8 ? 14 : Math.min(sidebar.s, 36));
  const sidebarBorder = toneFrom(sidebar, sidebar.l < 50 ? sidebar.l + 18 : sidebar.l - 14, Math.min(sidebar.s, 28));

  const primaryForeground = readableForegroundHsl(primary);
  const surfaces = [background, card, popover, secondary, muted];
  const primaryText = readableAccentText(primary, surfaces, isDark);
  const accentForeground = readableForegroundHsl(accent);
  const destructive = isDark ? { h: 0, s: 72, l: 46 } : { h: 0, s: 78, l: 52 };
  const warning = isDark ? { h: 38, s: 72, l: 58 } : { h: 35, s: 82, l: 45 };
  const destructiveForeground = readableForegroundHsl(destructive);
  const warningForeground = readableForegroundHsl(warning);
  const densityOption = DENSITY_OPTIONS[normalized.density] || DENSITY_OPTIONS.comfortable;

  const variables = {
    "--background": hslToVarString(background),
    "--foreground": hslToVarString(foreground),
    "--card": hslToVarString(card),
    "--card-foreground": hslToVarString(readableForegroundHsl(card)),
    "--popover": hslToVarString(popover),
    "--popover-foreground": hslToVarString(readableForegroundHsl(popover)),
    "--primary": hslToVarString(primary),
    "--primary-text": hslToVarString(primaryText),
    "--primary-foreground": hslToVarString(primaryForeground),
    "--primary-hover": hslToVarString(hoverTone(primary, primaryForeground)),
    "--secondary": hslToVarString(secondary),
    "--secondary-foreground": hslToVarString(readableForegroundHsl(secondary)),
    "--muted": hslToVarString(muted),
    "--muted-foreground": hslToVarString(mutedForeground),
    "--accent": hslToVarString(accent),
    "--accent-foreground": hslToVarString(accentForeground),
    "--destructive": hslToVarString(destructive),
    "--destructive-foreground": hslToVarString(destructiveForeground),
    "--destructive-hover": hslToVarString(hoverTone(destructive, destructiveForeground)),
    "--warning": hslToVarString(warning),
    "--warning-foreground": hslToVarString(warningForeground),
    "--warning-hover": hslToVarString(hoverTone(warning, warningForeground)),
    "--border": hslToVarString(border),
    "--input": hslToVarString(border),
    "--ring": hslToVarString(primary),
    "--chart-1": hslToVarString(primary),
    "--chart-2": hslToVarString(accent),
    "--chart-3": hslToVarString({ h: (primary.h + 75) % 360, s: Math.max(45, primary.s), l: isDark ? 58 : 44 }),
    "--chart-4": hslToVarString({ h: (accent.h + 120) % 360, s: Math.max(42, accent.s), l: isDark ? 62 : 48 }),
    "--chart-5": hslToVarString({ h: (primary.h + 220) % 360, s: Math.max(44, primary.s), l: isDark ? 64 : 46 }),
    "--radius": `${normalized.radius}rem`,
    "--density-scale": String(densityOption.scale),
    "--font-scale": String(normalized.fontScale),
    "--sidebar-background": hslToVarString(sidebar),
    "--sidebar-foreground": hslToVarString(sidebarForeground),
    "--sidebar-primary": hslToVarString(primary),
    "--sidebar-primary-foreground": hslToVarString(primaryForeground),
    "--sidebar-accent": hslToVarString(sidebarAccent),
    "--sidebar-accent-foreground": hslToVarString(readableForegroundHsl(sidebarAccent)),
    "--sidebar-border": hslToVarString(sidebarBorder),
    "--sidebar-ring": hslToVarString(primary)
  };
  for (const [family, color] of Object.entries(ACTION_COLORS)) {
    variables[`--action-${family}`] = hslToVarString(readableAccentText(hexToHsl(color), surfaces, isDark, 5));
  }

  return {
    variables,
    isDark,
    previewColors: [hslToHex(background), hslToHex(sidebar), normalized.primary],
    settings: normalized
  };
}

export function themeMeetsAa(themeLike, minimum = AA_CONTRAST) {
  const variables = themeLike.variables || themeLike;
  const pairs = [
    ["--background", "--foreground"],
    ["--card", "--card-foreground"],
    ["--popover", "--popover-foreground"],
    ["--primary", "--primary-foreground"],
    ["--secondary", "--secondary-foreground"],
    ["--accent", "--accent-foreground"],
    ["--destructive", "--destructive-foreground"],
    ["--sidebar-background", "--sidebar-foreground"],
    ["--sidebar-primary", "--sidebar-primary-foreground"],
    ["--sidebar-accent", "--sidebar-accent-foreground"]
  ];
  return pairs.every(([backgroundKey, foregroundKey]) => {
    const background = hslToHex(parseHslVar(variables[backgroundKey]));
    const foreground = hslToHex(parseHslVar(variables[foregroundKey]));
    return contrastRatio(background, foreground) >= minimum;
  });
}
