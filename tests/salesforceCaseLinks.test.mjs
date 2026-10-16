import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {renderToStaticMarkup} from "react-dom/server";

const require = createRequire(import.meta.url);
const result = await build({
  entryPoints: [path.resolve("src/components/links/ExternalIdLinks.jsx")], bundle: true, write: false,
  platform: "node", format: "cjs", alias: {"@": path.resolve("src")}, external: ["react"],
  plugins: [{
    name: "case-link-fixtures",
    setup(build) {
      build.onLoad({filter: /[\\/]lib[\\/]utils\.js$/}, () => ({
        contents: 'export const cn = (...values) => values.filter(Boolean).join(" ");'
      }));
      build.onLoad({filter: /caseIdIndexCache\.js$/}, () => ({
        contents: 'export const useCaseIdIndex = () => new Map([["123", "500Ps00001k7UchIAE"]]);'
      }));
      build.onResolve({filter: /^sonner$/}, () => ({path: "toast", namespace: "fixture"}));
      build.onLoad({filter: /.*/, namespace: "fixture"}, () => ({
        contents: "export const toast = {error: message => globalThis.__caseLinkErrors.push(message)};"
      }));
    }
  }]
});
const module = {exports: {}};
new Function("module", "exports", "require", result.outputFiles[0].text)(module, module.exports, require);
const {CaseNumberLink, SiteIdLink} = module.exports;

test("case links use one workspace for record, lookup, and search destinations", async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousErrors = globalThis.__caseLinkErrors;
  let mode = "workspace";
  const calls = [];
  const storage = {getItem: key => key.startsWith("enquote_app_preferences") ? JSON.stringify({salesforceMode: mode}) : null};
  globalThis.localStorage = storage;
  globalThis.window = {localStorage: storage, enquoteLocal: {salesforce: {openWorkspace: async url => {
    calls.push(url);
    return {ok: true};
  }}}};
  globalThis.__caseLinkErrors = [];
  const event = (changes = {}) => ({
    button: 0, stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.prevented = true; }, ...changes
  });
  try {
    for (const props of [
      {caseNumber: "123"},
      {caseNumber: "456", caseId: "500Ps00001k7UchIAE"},
      {caseNumber: "789"}
    ]) {
      const link = CaseNumberLink(props);
      const click = event();
      await link.props.onClick(click);
      assert.equal(click.prevented, true);
      assert.equal(click.stopped, true);
      assert.equal(calls.at(-1), link.props.href);
    }
    const link = CaseNumberLink({caseNumber: "123"});
    assert.equal(link.props.target, "_blank", "external fallback must not replace EnQuote");
    const initialCalls = calls.length;
    for (const changes of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {button: 1}]) {
      const click = event(changes);
      await link.props.onClick(click);
      assert.equal(click.prevented, false);
    }
    mode = "external";
    const externalClick = event();
    await link.props.onClick(externalClick);
    assert.equal(externalClick.prevented, false);
    mode = "workspace";
    delete globalThis.window.enquoteLocal;
    const browserClick = event();
    await link.props.onClick(browserClick);
    assert.equal(browserClick.prevented, false);
    assert.equal(calls.length, initialCalls);
    globalThis.window.enquoteLocal = {salesforce: {openWorkspace: async () => ({ok: false, error: "Network failed"})}};
    await link.props.onClick(event());
    assert.deepEqual(globalThis.__caseLinkErrors, ["Network failed"]);
    assert.match(renderToStaticMarkup(SiteIdLink({siteId: "123"})), /target="_blank"/);
    assert.equal(CaseNumberLink({caseNumber: "", fallback: "No case"}), "No case");
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
    globalThis.__caseLinkErrors = previousErrors;
  }
});
