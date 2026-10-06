import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);

test("All bar charts use vertical columns and width-constrained containers", async () => {
  const bars = [];
  const sizes = [];
  const series = [];
  const tooltips = [];
  const recharts = new Proxy({}, {get: (_, name) => props => {
    if (name === "BarChart") bars.push(props);
    if (name === "ResponsiveContainer") sizes.push(props.width);
    if (name === "Bar") series.push(props);
    if (name === "Tooltip") tooltips.push(props);
    return React.createElement("div", null, props.children);
  }});
  const mocks = {
    recharts,
    "@/components/ui/card": Object.fromEntries(["Card", "CardContent", "CardHeader", "CardTitle"].map(name => [
      name, ({children}) => React.createElement("div", null, children)
    ])),
    "@/components/ui/button": {Button: ({children}) => React.createElement("button", null, children)}
  };
  const output = await build({
    entryPoints: [path.join("src", "components", "quote-dashboard", "QuoteLifecycleCharts.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "chart-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => mocks[name] || require(name), module, module.exports
  );
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {
    report: {
      daily: [{date: "2026-10-01", created: 2, transitions: 1}],
      statuses: Array.from({length: 10}, (_, index) => ({status: `status-${index}`, count: 1})),
      durations: Array.from({length: 10}, (_, index) => ({from: "draft", to: `status-${index}`, average: 24, median: 24, longest: 48, count: 2})),
      timelines: [{currentHours: 24}]
    },
    range: {start: "2026-10-01", end: "2026-10-02"}, onInspect() {}
  }));
  assert.equal(bars.length, 3);
  assert.ok(bars.every(bar => bar.layout !== "vertical"), "Recharts vertical layout means horizontal bars");
  assert.equal(bars[0].data.length, 10, "Pipeline shows every status at once");
  assert.equal(bars[1].data.length, 4, "Turnaround retains category paging");
  assert.ok(!html.includes("pipeline statuses"), "Pipeline has no category paging controls");
  assert.deepEqual(sizes, ["100%", "100%", "100%", "100%"]);
  assert.ok(!html.includes("overflow-x-auto"));
  assert.ok(!html.includes("min-width"));
  assert.match(html, /Next/);
  assert.equal(series[0].onClick, undefined, "Pipeline bars cannot change filters");
  assert.equal(series[0].cursor, undefined, "Pipeline bars are display-only");
  assert.ok(series.every(item => !item.onClick && !item.cursor), "All bars are display-only");
  assert.ok(tooltips.every(item => React.isValidElement(item.content)), "Every chart uses header hover content");
  assert.ok(tooltips.every(item => item.position === undefined), "No chart overlays a positioned tooltip");
  for (const label of ["Activity", "Pipeline", "Turnaround", "Aging"]) {
    assert.ok(html.includes(`aria-label="${label} hover details"`));
  }
});
