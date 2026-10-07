import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {readFile} from "node:fs/promises";

const require = createRequire(import.meta.url);
async function load(entry, mocks = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
    packages: "external", jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "test-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  globalThis.window = {self: null, top: null};
  try {
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports
    );
  } finally {
    delete globalThis.window;
  }
  return module.exports;
}

test("both status snapshots preserve counts, links, and selection with matched card colors", async () => {
  const mocks = {
    "react-router-dom": {Link: ({children, to}) => React.createElement("a", {href: to}, children)},
    "lucide-react": {LayoutGrid: () => null},
    "@/utils": {createPageUrl: name => `/${name}`}
  };
  const quotes = [{status: "approved"}, {status: "approved"}, {status: "on_hold"}];
  const {default: Snapshot} = await load(path.join("src", "components", "sla", "StatusSnapshot.jsx"), mocks);
  const html = renderToStaticMarkup(React.createElement(Snapshot, {allQuotes: quotes}));
  assert.equal((html.match(/href=/g) || []).length, 13);
  assert.match(html, /Quotes\?status=approved/);
  assert.match(html, /text-3xl font-bold text-card-foreground">2</);
  assert.match(html, /bg-card text-card-foreground/);
  assert.doesNotMatch(html, /bg-(emerald|rose|purple|teal|indigo)-50\b/);
  const {default: QuoteSnapshot} = await load(path.join("src", "components", "quotes", "QuoteStatusSnapshot.jsx"), mocks);
  const selected = renderToStaticMarkup(React.createElement(QuoteSnapshot, {quotes, activeStatus: "approved"}));
  assert.equal((selected.match(/<button/g) || []).length, 13);
  assert.match(selected, /border-primary ring-1 ring-primary/);
  assert.match(selected, /text-2xl font-bold text-card-foreground">2</);
  assert.doesNotMatch(selected, /ring-indigo|shadow-md/);
});

test("shared primary buttons and reported actions use matched colors without glow", async () => {
  const {buttonVariants} = await load(path.join("src", "components", "ui", "button.jsx"));
  assert.match(buttonVariants(), /bg-primary text-primary-foreground/);
  assert.doesNotMatch(buttonVariants(), /\bshadow\b/);
  assert.match(buttonVariants(), /focus-visible:ring/);
  for (const page of ["Products", "Users", "MaterialOrders", "Quotes"]) {
    const source = await readFile(path.join("src", "pages", `${page}.jsx`), "utf8");
    assert.doesNotMatch(source, /shadow-indigo-200/);
    assert.match(source, /bg-primary text-primary-foreground hover:bg-primary\/90/);
  }
});
