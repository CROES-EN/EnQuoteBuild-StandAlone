import test from "node:test";
import assert from "node:assert/strict";
import {chatAppearanceStyles, normalizeChatAppearance, readableTextColor} from "../src/features/profiles/chatAppearanceStore.js";
import {contrastRatio} from "../src/features/theme/customThemeBuilder.js";

test("chat defaults follow theme tokens, preserving existing customized colors", () => {
  const defaults = normalizeChatAppearance(null);
  assert.equal(defaults.mode, "theme");
  assert.equal(chatAppearanceStyles(defaults).mine.backgroundColor, "hsl(var(--primary))");
  assert.equal(chatAppearanceStyles(defaults).mine.color, "hsl(var(--primary-foreground))");
  assert.equal(chatAppearanceStyles(defaults).background.backgroundColor, "hsl(var(--background))");
  const legacy = normalizeChatAppearance({mine: "#123456", theirs: "#fedcba", background: "#000000"});
  assert.equal(legacy.mode, "custom");
  assert.equal(chatAppearanceStyles(legacy).mine.backgroundColor, "#123456");
  assert.equal(normalizeChatAppearance({...legacy, mode: "theme"}).mode, "theme");
});

test("custom bubble foregrounds meet AA contrast for mid-tone and saturated colors", () => {
  for (const color of ["#ea580c", "#777777", "#00ff00", "#ff0000", "#123456", "#ffffff", "#000000"]) {
    assert.ok(contrastRatio(color, readableTextColor(color)) >= 4.5, `Readable foreground for ${color}`);
  }
});
