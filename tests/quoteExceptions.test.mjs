import test from "node:test";
import assert from "node:assert/strict";
import {buildQuoteExceptions} from "../src/features/supervisorDashboard/quoteExceptions.js";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const item = (id, extra = {}) => ({quote: {id, status: "submitted"}, issues: [], currentHours: 48, ...extra});

test("Exception priorities deduplicate quotes and preserve oldest-stage ordering", () => {
  const timelines = [
    item("red", {issues: ["Missing date"]}), item("gap", {issues: ["Status mismatch"]}),
    item("young", {currentHours: 24}), item("old", {currentHours: 120}),
    item("unknown", {currentHours: null}), item("paid", {quote: {id: "paid", status: "invoice_paid"}}),
    item("hold", {quote: {id: "hold", status: "on_hold"}, issues: ["Missing date"]}),
    item("excluded", {quote: {id: "excluded", status: "submitted", exclude_from_reporting: true}, issues: ["Missing date"]}),
    item("notification")
  ];
  const alerts = [
    {quote: {id: "red"}, alert: {level: "red", name: "Review Quote", timeLabel: "24 HRS OVERDUE", hoursInStatus: 48}},
    {quote: {id: "notification"}, alert: {level: "red", isNotification: true}},
    {quote: {id: "young"}, alert: {level: "yellow"}}
  ];
  const groups = buildQuoteExceptions(timelines, alerts);
  assert.deepEqual(groups.map(group => group.rows.map(row => row.quote.id)), [["red"], ["gap"], ["old", "notification", "young"]]);
  assert.match(groups[0].rows[0].reason, /24 HRS OVERDUE/);
  const ids = groups.flatMap(group => group.rows.map(row => row.quote.id));
  assert.equal(ids.length, new Set(ids).size);
});

async function loadPanel() {
  const require = createRequire(import.meta.url);
  const passthrough = ({children}) => React.createElement("div", null, children);
  const mocks = {
    "react-router-dom": {Link: ({children, to}) => React.createElement("a", {href: to}, children)},
    "@/utils": {createPageUrl: page => `/${page}`},
    "@/components/ui/button": {Button: ({children}) => React.createElement("button", null, children)}
  };
  for (const name of ["card", "table"]) mocks[`@/components/ui/${name}`] = new Proxy({}, {get: () => passthrough});
  const output = await build({
    entryPoints: [path.join("src", "components", "supervisor", "QuoteExceptionsPanel.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "exceptions-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => mocks[name] || require(name), module, module.exports
  );
  return props => renderToStaticMarkup(React.createElement(module.exports.default, {alertRows: [], onRetry() {}, ...props}));
}

test("Exception panel links quotes, limits initial rows and hides empty groups", async () => {
  const render = await loadPanel();
  const html = render({report: {timelines: Array.from({length: 12}, (_, index) => item(`quote-${index}`))}});
  assert.match(html, /Oldest open quotes/);
  assert.doesNotMatch(html, /<h4[^>]*>History gaps|<h4[^>]*>Overdue/);
  assert.match(html, /Show more oldest open quotes/);
  assert.match(html, /href="\/QuoteDetails\?id=quote-0"/);
  assert.doesNotMatch(html, /id=quote-10/);
  assert.match(html, /Open Quote Dashboard/);
});

test("Exception loading and errors never display an empty-success message", async () => {
  const render = await loadPanel();
  assert.match(render({loading: true, report: null}), /Loading quote exceptions/);
  const error = render({error: new Error("Source failed"), report: null});
  assert.match(error, /Source failed/);
  assert.match(error, /Retry quote exceptions/);
  assert.doesNotMatch(error, /No quote exceptions/);
  assert.match(render({report: {timelines: []}}), /No quote exceptions or open quotes/);
});
