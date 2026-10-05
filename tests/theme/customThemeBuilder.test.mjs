import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomTheme,
  contrastRatio,
  hslToHex,
  normalizeCustomThemeSettings,
  parseHslVar,
  readableForegroundHex,
  themeMeetsAa
} from "../../src/features/theme/customThemeBuilder.js";

function ratioFor(theme, backgroundKey, foregroundKey) {
  return contrastRatio(
    hslToHex(parseHslVar(theme.variables[backgroundKey])),
    hslToHex(parseHslVar(theme.variables[foregroundKey]))
  );
}

test("readableForegroundHex chooses AA foregrounds for difficult colors", () => {
  for (const color of ["#ffffff", "#000000", "#777777", "#facc15", "#2563eb", "#ef4444"]) {
    const foreground = readableForegroundHex(color);
    assert.ok(contrastRatio(color, foreground) >= 4.5, `${color} should contrast with ${foreground}`);
  }
});

test("custom light and dark themes derive complete AA token pairs", () => {
  const cases = [
    { mode: "light", backgroundTint: "#f4edff", sidebar: "#32115f", primary: "#7c1fd6", accent: "#0ea5e9" },
    { mode: "dark", backgroundTint: "#0f172a", sidebar: "#020617", primary: "#60a5fa", accent: "#34d399" },
    { mode: "light", backgroundTint: "#ff00aa", sidebar: "#00ffaa", primary: "#ffff00", accent: "#ff6600" }
  ];

  for (const settings of cases) {
    const theme = buildCustomTheme(settings);
    assert.equal(themeMeetsAa(theme), true);
    assert.ok(ratioFor(theme, "--primary", "--primary-foreground") >= 4.5);
    assert.ok(ratioFor(theme, "--sidebar-accent", "--sidebar-accent-foreground") >= 4.5);
    for (const token of [
      "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
      "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
      "--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
      "--warning", "--warning-foreground", "--border", "--input", "--ring", "--sidebar-background",
      "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-accent",
      "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring", "--chart-1", "--chart-2",
      "--chart-3", "--chart-4", "--chart-5", "--radius", "--density-scale", "--font-scale"
    ]) {
      assert.ok(theme.variables[token], `${token} exists`);
    }
  }
});

test("custom settings are normalized and legacy three-color themes still work", () => {
  const normalized = normalizeCustomThemeSettings({ background: "#111827", sidebar: "nope", primary: "#abc", radius: 9, density: "tiny" });
  assert.equal(normalized.mode, "dark");
  assert.equal(normalized.sidebar, "#1e1e2e");
  assert.equal(normalized.primary, "#aabbcc");
  assert.equal(normalized.radius, 1.5);
  assert.equal(normalized.density, "comfortable");

  const built = buildCustomTheme({ background: "#111827", sidebar: "#000000", primary: "#ffffff" });
  assert.equal(built.isDark, true);
  assert.equal(themeMeetsAa(built), true);
});

test("font scale and density emit runtime sizing variables", () => {
  const built = buildCustomTheme({ density: "compact", fontScale: 1.08 });
  assert.equal(built.settings.density, "compact");
  assert.equal(built.settings.fontScale, 1.08);
  assert.equal(built.variables["--density-scale"], "0.88");
  assert.equal(built.variables["--font-scale"], "1.08");
});
