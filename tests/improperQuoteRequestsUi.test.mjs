import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {createRequestReview} from "../src/features/autoDrafter/improperQuoteRequests.js";
import {AGGREGATION_MODES} from "../src/features/supervisorDashboard/periodAggregation.js";

const require = createRequire(import.meta.url);
async function load(entry, mocks = {}) {
  const output = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "review-test-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports
  );
  return module.exports;
}
const pass = ({children}) => React.createElement("div", null, children);
const boundaries = {
  "@/lib/utils": {cn: (...values) => values.filter(value => typeof value === "string").join(" ")},
  "lucide-react": new Proxy({}, {get: () => () => null}),
  "@/components/links/ExternalIdLinks": {
    CaseNumberLink: ({caseNumber}) => React.createElement("a", null, caseNumber),
    SiteIdLink: ({siteId, fallback}) => React.createElement("a", null, siteId || fallback)
  }
};

test("review records stay out of report listings and survive reimport/clear in browser storage", async () => {
  const previous = globalThis.window;
  const values = new Map();
  globalThis.window = {localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  }};
  try {
    const store = await load("src\\features\\supervisorDashboard\\importedTableStore.js");
    const review = createRequestReview({caseNumber: "00123", reviewer: "reviewer@example.com"});
    await store.appendQuoteRequestReview(review);
    await store.saveReportTable("quoteRequestCases", {columns: ["Case"], rows: [{Case: "00123"}]});
    assert.deepEqual(Object.keys(await store.listReportTables()), ["quoteRequestCases"]);
    await store.saveReportTable("quoteRequestCases", {columns: ["Case"], rows: [{Case: "456"}]});
    await store.deleteReportTable("quoteRequestCases");
    assert.deepEqual(await store.listReportTables(), {});
    assert.deepEqual(await store.listQuoteRequestReviews(), [review]);
    const reloaded = await load("src\\features\\supervisorDashboard\\importedTableStore.js");
    assert.deepEqual(await reloaded.listQuoteRequestReviews(), [review]);
    globalThis.window.localStorage.setItem = () => {throw new Error("disk full");};
    await assert.rejects(store.appendQuoteRequestReview(review), /disk full/);
    values.set("enquote_supervisor_report_tables_v1", "invalid JSON");
    await assert.rejects(store.listQuoteRequestReviews(), SyntaxError);
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test("contributing rows show reviewer/reason/state and sort newest first", async () => {
  const {default: Records} = await load("src\\components\\autoDrafter\\ImproperRequestRecords.jsx", boundaries);
  const html = renderToStaticMarkup(React.createElement(Records, {records: [
    {caseNumber: "OLDER-CASE", siteId: "123", at: "2026-10-04T12:00:00.000Z", reviewer: "old@example.com", reason: "Old reason", markingCount: 1, currentState: "Restored"},
    {caseNumber: "NEWER-CASE", siteId: "456", at: "2026-10-06T12:00:00.000Z", reviewer: "new@example.com", reason: "Incomplete scope", markingCount: 2, currentState: "Improper"}
  ]}));
  assert.ok(html.indexOf("NEWER-CASE") < html.indexOf("OLDER-CASE"));
  for (const text of ["Incomplete scope", "new@example.com", "Restored", "First marked in period", "Marking events", 'aria-sort="descending"']) assert.ok(html.includes(text), text);
  const filtered = renderToStaticMarkup(React.createElement(Records, {records: [
    {caseNumber: "00123", at: "2026-10-06T12:00:00Z", reviewer: "a", reason: "scope"}
  ], search: "missing"}));
  assert.match(filtered, /No improper requests found/);
});

test("supervisor tile displays the period value and contributing records without success-shaped errors", async () => {
  const event = createRequestReview({caseNumber: "00123", reviewer: "a@example.com"});
  let state = {data: [event], isLoading: false, isError: false};
  const {default: Tile} = await load("src\\components\\supervisor\\ImproperQuoteRequestsTile.jsx", {
    ...boundaries,
    "@/features/autoDrafter/useQuoteRequestReviews": {useQuoteRequestReviews: () => state},
    "@/components/ui/dialog": {Dialog: () => null, DialogContent: pass, DialogDescription: pass, DialogHeader: pass, DialogTitle: pass}
  });
  const props = {range: {start: "2020-01-01", end: "2030-01-01"}, mode: AGGREGATION_MODES.PERIOD_TOTAL};
  const render = () => renderToStaticMarkup(React.createElement(Tile, props));
  assert.match(render(), />1<\/p>/);
  assert.match(render(), /View contributing records/);
  state = {isError: true, error: new Error("unreachable")};
  assert.match(render(), /Unable to load request reviews: unreachable/);
  assert.doesNotMatch(render(), /View contributing records/);
  state = {isLoading: true};
  assert.match(render(), /Loading request reviews/);
});

test("raw and saved-draft tiles can be marked, and fresh improper marks block generation", async () => {
  const buttons = new Map();
  const errors = [];
  let generated = 0;
  let marked = 0;
  const event = createRequestReview({caseNumber: "00123", reviewer: "a@example.com"});
  let reviews = [event];
  const {default: Tile} = await load("src\\components\\autoDrafter\\AutoDrafterCaseTile.jsx", {
    ...boundaries,
    sonner: {toast: {error: message => errors.push(message), success() {}}},
    "framer-motion": {motion: {div: pass}},
    "@/components/quotes/StatusBadge": () => null,
    "@/components/ui/button": {Button: props => {
      const label = React.Children.toArray(props.children).filter(value => typeof value === "string").join("");
      buttons.set(label, props);
      return React.createElement("button", null, props.children);
    }},
    "@/features/supervisorDashboard/careEligibilityCache": {useCareEligibilityIndex: () => null},
    "@/features/supervisorDashboard/importedTableStore": {listQuoteRequestReviews: async () => reviews},
    "@/features/autoDrafter/parseQuoteRequestCase": {parseQuoteRequestCase: () => ({request: {}})},
    "@/features/quoteDraftAgent/draftEngine": {generateQuoteDraft: () => {generated += 1; return {};}},
    "@/features/autoDrafter/autoDrafterDraftsStore": {saveGeneratedDraft: async () => {}}
  });
  const props = {row: {Case: "00123", Comment: "O&M_QUOTE"}, caseNumberCol: "Case", commentCol: "Comment", onMarkImproper: () => {marked += 1;}};
  renderToStaticMarkup(React.createElement(Tile, props));
  buttons.get("Mark Improper Request").onClick();
  assert.equal(marked, 1);
  await buttons.get("Generate Draft").onClick();
  assert.equal(generated, 0);
  assert.match(errors[0], /marked improper/);
  reviews = [];
  await buttons.get("Generate Draft").onClick();
  assert.equal(generated, 1, "unmarked requests still generate normally");
  renderToStaticMarkup(React.createElement(Tile, {...props, savedDraftRecord: {siteId: "123", draft: {items: []}}}));
  assert.ok(buttons.get("Mark Improper Request"));
});

test("a fresh mark blocks Send to Quotes in already-open draft details", async () => {
  const buttons = new Map();
  const errors = [];
  let created = 0;
  const event = createRequestReview({caseNumber: "00123", reviewer: "a@example.com"});
  let reviews = [event];
  const {default: Details} = await load("src\\components\\autoDrafter\\AutoDrafterDraftDetails.jsx", {
    ...boundaries,
    "@/utils": {createPageUrl: page => `/${page}`},
    "react-router-dom": {useNavigate: () => () => {}},
    sonner: {toast: {error: message => errors.push(message), success() {}}},
    "@/components/quotes/StatusBadge": () => null,
    "@/components/ui/dialog": {Dialog: () => null, DialogContent: pass, DialogDescription: pass, DialogHeader: pass, DialogTitle: pass},
    "@/components/ui/button": {Button: props => {
      const label = React.Children.toArray(props.children).filter(value => typeof value === "string").join("");
      buttons.set(label, props);
      return React.createElement("button", null, props.children);
    }},
    "@/api/dataClient": {getCurrentUser: async () => ({email: "a@example.com"}), createQuote: async () => {created += 1; return {id: "quote"};}},
    "@/features/supervisorDashboard/importedTableStore": {listQuoteRequestReviews: async () => reviews},
    "@/features/autoDrafter/autoDrafterDraftsStore": {saveGeneratedDraft: async () => {}}
  });
  renderToStaticMarkup(React.createElement(Details, {caseNumber: "00123", record: {caseNumber: "00123", draft: {items: []}}}));
  assert.ok(buttons.get("Send to Quotes"));
  await buttons.get("Send to Quotes").onClick();
  assert.equal(created, 0);
  assert.match(errors[0], /marked improper/);
  reviews = [];
  await buttons.get("Send to Quotes").onClick();
  assert.equal(created, 1, "unmarked requests still send normally");
});
