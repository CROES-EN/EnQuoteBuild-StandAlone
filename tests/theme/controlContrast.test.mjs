import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {build} from "esbuild";
import postcss from "postcss";
import {
  buildCustomTheme, contrastRatio, hslToHex, parseHslVar
} from "../../src/features/theme/customThemeBuilder.js";

const result = await build({
  entryPoints: [path.resolve("src\\features\\theme\\themes.js")],
  bundle: true, write: false, platform: "node", format: "cjs",
  alias: {"@": path.resolve("src")}
});
const module = {exports: {}};
new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
const themes = [
  ...Object.values(module.exports.THEMES).filter(theme => theme.id !== "custom"),
  ...["light", "dark"].flatMap(mode => ["#000000", "#ffffff", "#ff0000", "#ffff00", "#00ff00", "#0000ff"].map(primary =>
    ({id: `custom-${mode}-${primary}`, ...buildCustomTheme({mode, primary, backgroundTint: "#ff00aa"})})))
];
const hex = (theme, token) => hslToHex(parseHslVar(theme.variables[token]));

test("legacy aliases follow the live theme instead of fixed light colors", () => {
  const css = postcss.parse(readFileSync(new URL("../../src/theme-overrides.css", import.meta.url), "utf8"));
  const aliases = new Map();
  css.walkRules(":root", rule => rule.walkDecls(decl => aliases.set(decl.prop, decl.value)));
  for (const [alias, token] of [
    ["--theme-bg-primary", "--background"],
    ["--theme-bg-secondary", "--card"],
    ["--theme-bg-tertiary", "--muted"],
    ["--theme-text-primary", "--foreground"],
    ["--theme-text-secondary", "--foreground"],
    ["--theme-text-muted", "--muted-foreground"],
    ["--theme-accent", "--primary"],
    ["--theme-input-bg", "--background"]
  ]) assert.equal(aliases.get(alias), `hsl(var(${token}))`);
  assert.match(readFileSync(new URL("../../src/main.jsx", import.meta.url), "utf8"), /import ['"]@\/theme-overrides\.css['"]/);
});

test("inherited text and accent links meet AA across preset and custom themes", () => {
  for (const theme of themes) {
    for (const surface of ["--background", "--card", "--popover", "--secondary", "--muted"]) {
      for (const text of ["--foreground", "--primary-text"]) {
        const ratio = contrastRatio(hex(theme, surface), hex(theme, text));
        assert.ok(ratio >= 4.5, `${theme.id} ${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test("filled action hover states retain their matched foreground contrast", () => {
  for (const theme of themes) {
    for (const family of ["primary", "warning", "destructive"]) {
      const ratio = contrastRatio(hex(theme, `--${family}-hover`), hex(theme, `--${family}-foreground`));
      assert.ok(ratio >= 4.5, `${theme.id} ${family} hover contrast: ${ratio.toFixed(2)}`);
    }
  }
});

test("semantic outline and ghost actions meet AA in normal and hover states", () => {
  const css = postcss.parse(readFileSync(new URL("../../src/theme-overrides.css", import.meta.url), "utf8"));
  const colors = new Map();
  css.walkDecls("--theme-action-color", declaration => {
    const family = declaration.parent.selector.match(/text-([a-z]+)-/)[1];
    colors.set(family, `--action-${family}`);
    assert.equal(declaration.value, `hsl(var(--action-${family}))`);
    assert.ok(declaration.parent.selector.startsWith(".theme-button"));
    assert.ok(declaration.parent.selector.includes('data-button-variant="outline"'));
    assert.ok(declaration.parent.selector.includes('data-button-variant="ghost"'));
  });
  assert.equal(colors.size, 16);
  for (const theme of themes) {
    for (const [family, color] of colors) {
      for (const surface of ["--background", "--card", "--popover", "--secondary", "--muted"]) {
        const ratio = contrastRatio(hex(theme, color), hex(theme, surface));
        assert.ok(ratio >= 4.5, `${theme.id} ${family} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  }
});
