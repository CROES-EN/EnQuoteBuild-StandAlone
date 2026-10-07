import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import postcss from "postcss";

const css = readFileSync(new URL("../src/theme-overrides.css", import.meta.url), "utf8");
const rules = postcss.parse(css);
const colors = new Map();
rules.walkRules(rule => {
  rule.walkDecls("--workload-badge-rgb", declaration => {
    const family = rule.selector.match(/text-([a-z]+)-/)[1];
    colors.set(family, declaration.value.split(" ").map(Number));
    assert.ok(rule.selector.startsWith(".dark .workload-color-badge"));
  });
});

const luminance = rgb => rgb.map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const composite = (color, background, alpha) => color.map((value, index) => value * alpha + background[index] * (1 - alpha));

test("all Workload semantic color families have bright dark-only overrides", () => {
  for (const family of ["red", "rose", "yellow", "amber", "orange", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "purple", "violet", "fuchsia"]) {
    assert.ok(colors.has(family), `${family} is supported`);
  }
  rules.walkRules(rule => {
    if (rule.selector.includes("workload-color-badge")) {
      assert.ok(rule.selector.split(",").every(selector => selector.trim().startsWith(".dark ")),
        "light themes must not be affected");
    }
  });
});

test("badge text maintains at least 4.5:1 contrast on dark surfaces and hovered quote badges", () => {
  for (const [family, color] of colors) {
    for (const surface of [[30, 30, 30], [39, 40, 34], [0, 43, 54], [15, 23, 42], [55, 65, 81]]) {
      for (const opacity of family === "indigo" ? [0.16, 0.18] : [0.16]) {
        const background = composite(color, surface, opacity);
        const contrast = (luminance(color) + 0.05) / (luminance(background) + 0.05);
        assert.ok(contrast >= 4.5, `${family} contrast ${contrast.toFixed(2)} on ${surface} at ${opacity}`);
      }
    }
  }
});
