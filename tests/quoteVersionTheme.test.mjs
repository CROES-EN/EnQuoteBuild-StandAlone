import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {buildCustomTheme, contrastRatio, hslToHex, parseHslVar} from "../src/features/theme/customThemeBuilder.js";

const require = createRequire(import.meta.url);

async function bundle(entry, mocks = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "test-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports
  );
  return module.exports;
}

test("quote version surfaces use readable theme pairs and preserve content and restore controls", async () => {
  globalThis.window = {self: null, top: null};
  try {
    const old = {id: "v1", version_number: 1, is_current_version: false, status: "rejected", total: 1187.89, created_date: "2026-07-28T20:08:00Z", rejection_reason: "Review scope", ho_rejection_reason: "Cost", items: [{name: "Previous item", total: 10}]};
    const current = {id: "v2", parent_quote_id: "v1", version_number: 2, is_current_version: true, status: "quote_missing_details", total: 1555.06, created_date: "2026-10-02T20:18:00Z", items: [{name: "Updated item", total: 20}]};
    const wrapper = ({children}) => React.createElement("div", null, children);
    let stateIndex = 0;
    const mocks = {
      "@/api/dataClient": {},
      "@tanstack/react-query": {useQuery: () => ({data: [current, old], isLoading: false})},
      "react-router-dom": {Link: ({children, to, ...props}) => React.createElement("a", {...props, href: to}, children)},
      "lucide-react": new Proxy({}, {get: () => () => null}),
      "@/components/links/ExternalIdLinks": {},
      "./StatusBadge": ({status}) => React.createElement("span", null, status),
      "@/components/ui/dialog": {Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper, DialogTitle: wrapper},
      "@/components/ui/select": {Select: wrapper, SelectContent: wrapper, SelectItem: wrapper, SelectTrigger: wrapper, SelectValue: wrapper},
      react: {...React, useState: () => [stateIndex++ === 0 ? true : "v1", () => {}]}
    };
    const {default: History} = await bundle(path.join("src", "components", "quotes", "QuoteVersionHistory.jsx"), mocks);
    const history = renderToStaticMarkup(React.createElement(History, {quote: current, canRestore: true, onRestore: () => {}}));
    assert.match(history, /bg-secondary text-secondary-foreground border-primary\/40/);
    assert.match(history, /bg-primary text-primary-foreground/);
    assert.match(history, /\$1555\.06/);
    assert.match(history, /Current/);
    assert.match(history, /Restore/);
    const {default: Comparison} = await bundle(path.join("src", "components", "quotes", "QuoteVersionComparison.jsx"), mocks);
    const comparison = renderToStaticMarkup(React.createElement(Comparison, {quote: current}));
    assert.match(comparison, /bg-card text-card-foreground border border-warning\/50/);
    assert.match(comparison, /text-xs text-card-foreground border-warning\/50/);
    assert.match(comparison, /Review scope/);
    assert.match(comparison, /Previous item/);
    assert.match(comparison, /Updated item/);
    assert.match(comparison, /border-rose-500\/40/);
    assert.match(comparison, /border-emerald-500\/40/);
    for (const html of [history, comparison]) {
      assert.doesNotMatch(html, /bg-(indigo|amber|rose|emerald|red)-50(?: |")/);
      assert.doesNotMatch(html, /text-(indigo|amber|rose|emerald|red)-(600|700|800|900)/);
    }
  } finally {
    delete globalThis.window;
  }
});

test("version card, text, and current badge colors meet AA in every preset and custom light/dark themes", async () => {
  const {THEMES} = await bundle(path.join("src", "features", "theme", "themes.js"));
  const themes = [
    ...Object.values(THEMES).filter(theme => theme.id !== "custom"),
    buildCustomTheme({mode: "light", backgroundTint: "#f4edff", primary: "#7c1fd6"}),
    buildCustomTheme({mode: "dark", backgroundTint: "#0f172a", primary: "#60a5fa"})
  ];
  for (const theme of themes) {
    for (const [background, foreground] of [["--card", "--card-foreground"], ["--secondary", "--secondary-foreground"], ["--primary", "--primary-foreground"]]) {
      const ratio = contrastRatio(hslToHex(parseHslVar(theme.variables[background])), hslToHex(parseHslVar(theme.variables[foreground])));
      assert.ok(ratio >= 4.5, `${theme.id || "custom"} ${background} contrast ${ratio}`);
    }
  }
});
