import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
const at = day => new Date(2026, 8, day, 12).toISOString();
const quotes = [
  {id: "q1", created_date: at(1), status: "approved", status_history: [
    {status: "draft", changed_at: at(1)}, {status: "approved", changed_at: at(2)},
    {status: "approved", changed_at: at(3), entry_type: "follow_up"}
  ]},
  {id: "q2", created_date: at(2), status: "draft", status_history: [
    {status: "draft", changed_at: at(2)}, {status: "draft", changed_at: at(4), entry_type: "follow_up"}
  ]}
];

async function loadOverview() {
  const state = {range: {start: "2026-09-02", end: "2026-09-04"}, queries: [], retry: 0, tiles: [], tables: {}, updates: []};
  const passthrough = ({children}) => React.createElement("div", null, children);
  const mocks = {
    "react-router-dom": {useSearchParams: () => [new URLSearchParams(), () => {}]},
    react: {...React, useState: initial => {
      const [value] = React.useState(initial);
      return [initial === "period_total" && state.mode ? state.mode : value, next => state.updates.push(next)];
    }},
    "lucide-react": new Proxy({}, {get: () => () => null}),
    "@tanstack/react-query": {useQuery: options => {
      state.queries.push(options);
      const key = options.queryKey[0];
      return {
        data: key === "quotes" ? quotes : key === "quoteActivity" ? [] : state.tables,
        isLoading: Boolean(state.loading && key === state.loading),
        isError: Boolean(state.error && key === state.error),
        error: state.error === key ? new Error("Source unavailable") : null,
        refetch() { state.retry++; }
      };
    }},
    "@/api/dataClient": {getQuotes: async () => quotes, getAllQuoteActivities: async () => []},
    "@/features/supervisorDashboard/useReportingPeriodPreference": {
      useReportingPeriodPreference: () => [state.range, () => {}]
    },
    "@/features/supervisorDashboard/importedTableStore": {listReportTables: async () => ({})},
    "@/components/ui/dialog": {
      Dialog: ({open, children}) => open ? children : null,
      DialogContent: passthrough, DialogHeader: passthrough, DialogTitle: passthrough
    },
    "@/components/links/ExternalIdLinks": {CaseNumberLink: passthrough, SiteIdLink: passthrough},
    "@/components/supervisor/TileGrid": ({tiles}) => {
      state.tiles = tiles;
      return React.createElement("div", null, tiles.map(tile =>
        React.createElement("section", {"data-tile": tile.id, key: tile.id}, tile.render())));
    }
  };
  const uiMock = new Proxy({}, {get: () => passthrough});
  const noComponent = () => null;
  const output = await build({
    entryPoints: [path.join("src", "components", "supervisor", "DashboardOverview.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{name: "overview-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args => {
        if (Object.hasOwn(mocks, args.path) || args.path.startsWith("@/components/ui/")
          || (args.path.startsWith("@/components/") && args.path !== "@/components/supervisor/QuotePeriodActivityTile")) {
          return {path: args.path, external: true};
        }
      });
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    name => Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/components/ui/") ? uiMock
        : name.startsWith("@/components/") ? noComponent : require(name),
    module, module.exports
  );
  state.render = () => renderToStaticMarkup(React.createElement(module.exports.default, {records: []}));
  return state;
}

function tileHtml(html, metric) {
  return html.match(new RegExp(`<section data-tile="quotes_${metric}_period">([\\s\\S]*?)</section>`))[1];
}

test("Executive tiles use selected-period unique counts and belong to Live from EnQuote", async () => {
  const state = await loadOverview();
  const html = state.render();
  for (const removed of ["Historical Operations Trend", "Source Coverage", "Requires Attention", "Additional Trends (AHT, Emails, Staffing)"]) {
    assert.ok(!html.includes(removed), `${removed} is no longer displayed`);
  }
  for (const metric of ["created", "worked"]) {
    const tile = state.tiles.find(tile => tile.id === `quotes_${metric}_period`);
    assert.equal(tile.category, "Live from EnQuote");
    assert.match(tileHtml(html, metric), /Period Total/);
    assert.match(tileHtml(html, metric), />Live from EnQuote<\/p>/);
    assert.match(tileHtml(html, metric), /View contributing records/);
    assert.doesNotMatch(tileHtml(html, metric), /creation activity|each quote counted once|Selected reporting period/);
  }
  assert.match(tileHtml(html, "created"), /text-foreground">1</);
  assert.match(tileHtml(html, "worked"), /text-foreground">2</);
  assert.ok(state.queries.some(query => query.queryKey.join(":") === "quoteActivity:lifecycle"));
  assert.ok(state.queries.some(query => query.queryKey.join(":") === "quotes:executive-overview"));
  state.range = {start: "2026-09-04", end: "2026-09-04"};
  const next = state.render();
  assert.match(tileHtml(next, "created"), /text-foreground">0</);
  assert.match(tileHtml(next, "worked"), /text-foreground">1</);
});

test("Quote tiles show loading and retryable source failures rather than zero", async () => {
  const state = await loadOverview();
  for (const key of ["quotes", "quoteActivity"]) {
    state.loading = key;
    const loading = state.render();
    for (const metric of ["created", "worked"]) {
      assert.match(tileHtml(loading, metric), /Loading quote activity/);
      assert.doesNotMatch(tileHtml(loading, metric), /text-foreground">\d+</);
      assert.doesNotMatch(tileHtml(loading, metric), /View contributing records/);
    }
    state.loading = null;
    state.error = key;
    const failed = state.render();
    for (const metric of ["created", "worked"]) {
      assert.match(tileHtml(failed, metric), /Source unavailable/);
      assert.match(tileHtml(failed, metric), /Try Again/);
      assert.doesNotMatch(tileHtml(failed, metric), /text-foreground">\d+</);
      assert.doesNotMatch(tileHtml(failed, metric), /View contributing records/);
    }
    const element = state.tiles.find(tile => tile.id === "quotes_created_period").render();
    element.props.onRetry();
    assert.ok(state.retry >= 2);
    state.error = null;
  }
});

test("Executive quote tiles omit history/date warnings without changing their counts", async () => {
  const state = await loadOverview();
  state.render();
  for (const [metric, count] of [["created", 1], ["worked", 2]]) {
    const tile = state.tiles.find(tile => tile.id === `quotes_${metric}_period`).render();
    const report = {
      ...tile.props.report,
      issues: Array.from({length: 12}, () => ({})),
      periodIssues: [{}],
      undatedIssues: [{}, {}]
    };
    const html = renderToStaticMarkup(React.cloneElement(tile, {report}));
    assert.doesNotMatch(html, /warnings|history\/date|undated/);
    assert.match(html, new RegExp(`text-foreground">${count}<`));
    assert.match(html, /Period Total/);
  }
});

test("Quote actions open unique quote lists; EODB actions open matching NICE records with report totals", async () => {
  const state = await loadOverview();
  const widget = value => ({rows: [{Date: "Skillname", "2026-09-02": "Count"}, {Date: "Grand Total", "2026-09-02": value}]});
  state.tables = {
    eodb_total_call_volume: widget(3), eodb_abandoned_calls: widget(2),
    incorta_input: {rows: [
      {"Contact ID": "a", "Contact Start Time (PST)": "9/2/26 9:00:00 AM", Abandons: "1"},
      {"Contact ID": "h", "Contact Start Time (PST)": "9/2/26 9:01:00 AM", Handled: "1"}
    ]}
  };
  state.render();
  for (const [metric, ids] of [["created", ["q2"]], ["worked", ["q1", "q2"]]]) {
    state.tiles.find(tile => tile.id === `quotes_${metric}_period`).render().props.onViewRecords();
    const selection = state.updates.at(-1);
    assert.deepEqual(selection.records.map(record => record.quote.id).sort(), ids);
  }
  state.tiles.find(tile => tile.id === "eodb_abandoned").render().props.onViewRecords();
  const abandoned = state.updates.at(-1);
  assert.equal(abandoned.rawCalls.expected, 2);
  assert.deepEqual(abandoned.rawCalls.records.map(call => call.row["Contact ID"]), ["a"]);
  state.tiles.find(tile => tile.id === "eodb_handled").render().props.onViewRecords();
  const handled = state.updates.at(-1);
  assert.equal(handled.records[0].value, 1, "Handled daily summary is not total call volume");
  assert.equal(handled.rawCalls.expected, 1);
  assert.deepEqual(handled.rawCalls.records.map(call => call.row["Contact ID"]), ["h"]);
});

test("KPI mode updates quote and EODB values, badges and latest-day drill-downs", async () => {
  const state = await loadOverview();
  const widget = (a, b) => ({rows: [
    {Date: "Skillname", "2026-09-02": "Count", "2026-09-04": "Count"},
    {Date: "Grand Total", "2026-09-02": a, "2026-09-04": b}
  ]});
  state.tables = {eodb_total_call_volume: widget(10, 20), eodb_abandoned_calls: widget(2, 4)};
  state.mode = "daily_average";
  let html = state.render();
  assert.match(tileHtml(html, "worked"), /text-foreground">1</);
  assert.match(tileHtml(html, "created"), /text-foreground">0.33</);
  assert.equal(state.tiles.find(tile => tile.id === "eodb_total_interactions").render().props.value, "15");
  state.mode = "latest_day";
  html = state.render();
  assert.match(tileHtml(html, "worked"), /text-foreground">1</);
  assert.match(tileHtml(html, "created"), /text-foreground">0</);
  assert.match(tileHtml(html, "worked"), /Latest Day/);
  state.tiles.find(tile => tile.id === "quotes_worked_period").render().props.onViewRecords();
  assert.deepEqual(state.updates.at(-1).records.map(record => record.quote.id), ["q2"]);
  const eodb = state.tiles.find(tile => tile.id === "eodb_total_interactions").render();
  assert.equal(eodb.props.value, "20");
  eodb.props.onViewRecords();
  assert.deepEqual(state.updates.at(-1).records.map(record => record.date), ["2026-09-04"]);
});
