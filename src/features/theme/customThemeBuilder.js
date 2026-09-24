/**
 * customThemeBuilder.js
 *
 * Turns 3 user-picked hex colors (Background, Sidebar, Primary/Accent) into a full
 * shadcn-compatible theme `variables` object - the same shape every entry in themes.js
 * already has (e.g. THEMES["monokai"].variables).
 *
 * WHY DERIVE THE REST INSTEAD OF ASKING FOR MORE COLORS:
 * Every existing theme (Monokai, Rose Gold, etc.) was hand-tuned by a human picking ~26
 * separate HSL values so text stays readable and borders/muted areas look intentional.
 * Asking a user to pick 26 colors themselves would be tedious and error-prone (e.g. picking
 * white text on a white background). Instead, this derives the other values using simple,
 * predictable rules:
 *   - Text color (foreground) is chosen automatically (near-black or near-white) based on
 *     how light or dark the background is, so it's ALWAYS readable - never picked directly.
 *   - Muted/border/input tones are small lightness steps away from the background, in the
 *     direction that increases contrast (lighten a dark background's tones, darken a light
 *     background's tones) - this is exactly what "light+ 5% lighter card" style theming
 *     tools do.
 *   - The sidebar gets its own foreground/accent derived the same way, independently, since
 *     it's a visually distinct region that may be a very different lightness than the main
 *     background (e.g. a light background with a dark sidebar, as several existing themes
 *     already do).
 */

// --- Color space conversion -------------------------------------------------------------
// shadcn's CSS variables are stored as "H S% L%" (space-separated, no hsl() wrapper) -
// see the big comment at the top of themes.js. Browsers give/accept colors as hex
// (#rrggbb) in a native <input type="color"> picker, so this converts one direction.

/**
 * Converts a hex color string (e.g. "#4f46e5" or "4f46e5") into { h, s, l } where h is in
 * degrees (0-360) and s/l are percentages (0-100), rounded to whole numbers (matching the
 * precision already used throughout themes.js, e.g. "243 75% 59%").
 */
export function hexToHsl(hex) {
  const cleaned = String(hex || "").trim().replace(/^#/, "");
  const normalized =
    cleaned.length === 3
      ? cleaned.split("").map((c) => c + c).join("")
      : cleaned.padEnd(6, "0").slice(0, 6);

  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/** Formats an { h, s, l } object as the "H S% L%" string shadcn's CSS variables expect. */
export function hslToVarString({ h, s, l }) {
  return `${h} ${s}% ${l}%`;
}

/** Clamps a number between 0 and 100 - used to keep derived lightness values valid. */
function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

/**
 * Nudges a color's LIGHTNESS toward a "safe" zone for large surface areas (a page
 * background or sidebar background) - genuinely dark (<= 20%) or genuinely light
 * (>= 85%) - leaving it untouched if it's already in either zone.
 *
 * WHY THIS MATTERS: every hand-authored theme in themes.js (Monokai, Midnight Slate,
 * etc.) follows this rule already, even when its nominal HSL saturation is fairly high -
 * e.g. Midnight Slate's background is "222 47% 8%" (47% saturation is NOT low), but at
 * only 8% lightness it still reads as calm near-black, because a color's PERCEIVED
 * vividness depends on both saturation and how far lightness sits from 50% - a color at
 * 50% lightness + high saturation (e.g. a "pure" picked blue or purple) is the single
 * most visually loud combination possible, and no amount of adjusting derived
 * cards/borders/muted tones can compensate for a huge background area using that
 * combination - they're all still anchored to the same overpowering base hue.
 *
 * Only backgrounds/sidebars go through this - --primary (buttons, links, active-state
 * highlights) is deliberately left fully vivid, exactly like every hand-authored theme's
 * own --primary value.
 */
function toSafeSurfaceLightness(hsl) {
  const SAFE_DARK_MAX = 20;
  const SAFE_LIGHT_MIN = 85;
  if (hsl.l <= SAFE_DARK_MAX || hsl.l >= SAFE_LIGHT_MIN) {
    return hsl; // Already a safe, calm surface lightness - pass through unchanged.
  }
  // Sits in the "loud" middle zone - snap toward whichever safe zone is nearer, keeping
  // the hue itself intact so the surface still reflects the color family the user picked
  // (e.g. a mid-tone blue becomes a dark navy, not an unrelated dark gray).
  return { h: hsl.h, s: hsl.s, l: hsl.l < 50 ? SAFE_DARK_MAX : SAFE_LIGHT_MIN };
}

/**
 * Given a base color's HSL, returns readable foreground text HSL: near-white for a dark
 * base, near-black for a light base. Matches the pattern already visible across every
 * hand-authored theme in themes.js (e.g. dark themes use "0 0% 8x%" foregrounds, light
 * themes use very low lightness foregrounds).
 */
function pickForeground(baseHsl) {
  return baseHsl.l > 55
    ? { h: baseHsl.h, s: Math.min(baseHsl.s, 30), l: 12 } // dark text on a light base
    : { h: baseHsl.h, s: Math.min(baseHsl.s, 20), l: 95 }; // light text on a dark base
}

/**
 * Derives a "one step further" tone from a base color - used for cards/muted/border/
 * sidebar-accent areas. Two things are deliberately done here, not just a lightness shift:
 *
 *   1. SATURATION IS CAPPED, not carried through unchanged. A surface derived from a
 *      strongly saturated base color (e.g. a vivid red) previously kept that same high
 *      saturation, so every derived panel/border/box ended up reading as "just another
 *      shade of red" - nothing looked like a distinct surface, it all visually blended
 *      together. Capping saturation makes these read as neutral panels instead, the same
 *      way VS Code's own dark themes keep side-panels/borders muted gray-ish even when the
 *      accent color itself is vivid.
 *   2. THE LIGHTNESS STEP IS LARGER than before (was too subtle to notice, especially once
 *      saturation was also fighting for attention).
 *
 * On a light base, steps DARKER (more contrast against white); on a dark base, steps
 * LIGHTER (more contrast against black). `amount` is in lightness percentage points.
 * `maxSaturation` caps how saturated the derived surface is allowed to be (0-100).
 */
function deriveStep(baseHsl, amount, maxSaturation = 100) {
  const isLightBase = baseHsl.l > 55;
  const nextLightness = clampPercent(isLightBase ? baseHsl.l - amount : baseHsl.l + amount);
  return { h: baseHsl.h, s: Math.min(baseHsl.s, maxSaturation), l: nextLightness };
}

/**
 * Builds a full shadcn `variables` object (same shape as every THEMES[...].variables
 * entry) from exactly 3 user-picked hex colors.
 *
 * @param {Object} colors
 * @param {string} colors.background - main app background, hex (e.g. "#f8fafc")
 * @param {string} colors.sidebar - sidebar background, hex (e.g. "#1e1e2e")
 * @param {string} colors.primary - primary/accent color used for buttons, links,
 *   active nav highlight, etc., hex (e.g. "#4f46e5")
 * @returns {{ variables: Object, isDark: boolean, previewColors: string[] }}
 */
export function buildCustomTheme(colors) {
  // Background/sidebar are large surface areas - remapped into a safe lightness zone
  // (see toSafeSurfaceLightness() above) if the raw pick is a "loud" mid-tone. Primary is
  // deliberately NOT remapped - it's meant to be vivid, used only for small accents like
  // buttons/links/active highlights, not a huge surface area.
  const backgroundHsl = toSafeSurfaceLightness(hexToHsl(colors.background));
  const sidebarHsl = toSafeSurfaceLightness(hexToHsl(colors.sidebar));
  const primaryHsl = hexToHsl(colors.primary);

  const foreground = pickForeground(backgroundHsl);
  const sidebarForeground = pickForeground(sidebarHsl);
  const primaryForeground = pickForeground(primaryHsl);

  // Card/secondary/muted/border are all "neutral panel" surfaces - capped at a modest
  // saturation regardless of how vivid the picked background is, so a strongly-colored
  // background (e.g. a saturated red) still produces visibly distinct, calm surfaces
  // instead of every panel reading as "another shade of the same color."
  const card = deriveStep(backgroundHsl, 6, 25);
  const secondary = deriveStep(backgroundHsl, 10, 18);
  const muted = deriveStep(backgroundHsl, 10, 18);
  const border = deriveStep(backgroundHsl, 18, 20);

  // Sidebar accent/border get the same treatment - this is what fixes boxes like "Signed
  // in as" or "Refresh App" blending invisibly into a saturated sidebar background.
  const sidebarAccent = deriveStep(sidebarHsl, 14, 30);
  const sidebarBorder = deriveStep(sidebarHsl, 20, 25);

  const variables = {
    "--background": hslToVarString(backgroundHsl),
    "--foreground": hslToVarString(foreground),
    "--card": hslToVarString(card),
    "--card-foreground": hslToVarString(foreground),
    "--popover": hslToVarString(card),
    "--popover-foreground": hslToVarString(foreground),
    "--primary": hslToVarString(primaryHsl),
    "--primary-foreground": hslToVarString(primaryForeground),
    "--secondary": hslToVarString(secondary),
    "--secondary-foreground": hslToVarString(foreground),
    "--muted": hslToVarString(muted),
    // Deliberately near-neutral (very low saturation) regardless of the picked hue, so
    // secondary/muted text reads as calm gray text - not a low-contrast tint of whatever
    // color the user picked - while still landing on the correct side (lighter text on a
    // dark background, darker text on a light background) for real readability.
    "--muted-foreground": hslToVarString({ h: foreground.h, s: 8, l: foreground.l > 50 ? 68 : 42 }),
    "--accent": hslToVarString(primaryHsl),
    "--accent-foreground": hslToVarString(primaryForeground),
    // Destructive (error/delete) stays a fixed, familiar red regardless of the custom
    // palette - consistent with every other theme in themes.js, none of which derive
    // destructive from their own base colors either.
    "--destructive": "0 84.2% 60.2%",
    "--destructive-foreground": "0 0% 98%",
    "--border": hslToVarString(border),
    "--input": hslToVarString(border),
    "--ring": hslToVarString(primaryHsl),
    "--sidebar-background": hslToVarString(sidebarHsl),
    "--sidebar-foreground": hslToVarString(sidebarForeground),
    "--sidebar-primary": hslToVarString(primaryHsl),
    "--sidebar-primary-foreground": hslToVarString(primaryForeground),
    "--sidebar-accent": hslToVarString(sidebarAccent),
    "--sidebar-accent-foreground": hslToVarString(sidebarForeground),
    "--sidebar-border": hslToVarString(sidebarBorder),
    "--sidebar-ring": hslToVarString(primaryHsl)
  };

  return {
    variables,
    isDark: backgroundHsl.l < 50,
    previewColors: [colors.background, colors.sidebar, colors.primary]
  };
}

/** Sensible starting colors when a user opens the custom color pickers for the first time. */
export const DEFAULT_CUSTOM_COLORS = {
  background: "#f8fafc",
  sidebar: "#1e1e2e",
  primary: "#4f46e5"
};
