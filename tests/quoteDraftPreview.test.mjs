import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
async function bundle(entry, mocks = {}) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node",
    format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "preview-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path)
        ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports
  );
  return module.exports;
}

const engine = await bundle(path.join("src", "features", "quoteDraftAgent", "draftEngine.js"));
const passthrough = ({children}) => React.createElement("div", null, children);

async function renderPreview(draft) {
  let stateIndex = 0;
  const states = [true, "", draft, null, false, [], null];
  const mocks = {
    react: {...React, useState: () => [states[stateIndex++], () => {}]},
    "lucide-react": {AlertTriangle: () => null, Check: () => null, ExternalLink: () => null, Sparkles: () => null},
    sonner: {toast: {}},
    "@/components/ui/button": {Button: passthrough},
    "@/components/ui/dialog": {
      Dialog: passthrough, DialogContent: passthrough, DialogDescription: passthrough,
      DialogFooter: passthrough, DialogHeader: passthrough, DialogTitle: passthrough
    },
    "@/components/ui/textarea": {Textarea: passthrough},
    "@/components/links/ExternalIdLinks": {
      CaseNumberLink: ({caseNumber}) => caseNumber,
      SiteIdLink: ({siteId}) => siteId
    }
  };
  const component = await bundle(path.join("src", "features", "quoteDraftAgent", "QuoteDraftButton.jsx"), mocks);
  return renderToStaticMarkup(React.createElement(component.default, {onApply() {}}));
}

const request = names => ({
  siteId: "12345", caseNumber: "00123456", technicianCount: 1, onsiteLaborHours: 2,
  driveHours: 1, driveMiles: 20,
  products: names.map(name => ({name, quantity: 1, unit: "each", notes: ""})),
  services: [], materials: []
});

test("draft preview renders real mixed IQ8 suggestion and generalized reason advisories without crashing", async () => {
  const draft = engine.generateQuoteDraft(request(["Enphase IQ8M Microinverter", "Enphase IQ Combiner 6C"]));
  assert.ok(draft.dependency_advisories.some(advisory => Array.isArray(advisory.suggestions)));
  assert.ok(draft.dependency_advisories.some(advisory => !advisory.suggestions && advisory.reason));
  const html = await renderPreview(draft);
  for (const advisory of draft.dependency_advisories) {
    if (advisory.suggestions) {
      for (const suggestion of advisory.suggestions) assert.ok(html.includes(suggestion.name || "IQ Disconnect Tool"));
    } else {
      assert.ok(html.includes(advisory.reason.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;")));
    }
  }
  assert.match(html, /Apply to Quote/);
});

test("draft preview renders generalized-only dependency advice and no-advisory drafts", async () => {
  const draft = engine.generateQuoteDraft(request(["Enphase IQ Combiner 6C"]));
  draft.dependency_advisories = draft.dependency_advisories.filter(advisory => !advisory.suggestions);
  assert.ok(draft.dependency_advisories.length > 0);
  assert.match(await renderPreview(draft), /Suggested accessories to review/);
  const ordinary = engine.generateQuoteDraft(request([]));
  assert.equal(ordinary.dependency_advisories.length, 0);
  assert.doesNotMatch(await renderPreview(ordinary), /Suggested accessories to review/);
});
