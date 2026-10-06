import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);

async function bundle(entry, mocks) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node",
    format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({filter: /./}, args => {
          if (Object.hasOwn(mocks, args.path)) return {path: args.path, external: true};
        });
      }
    }]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports
  );
  return module.exports;
}

test("inactive dashboard and drill-down render query errors without reading missing data", async () => {
  globalThis.window = {self: null, top: null};
  try {
    let query;
    const mocks = {
      "@/components/auth/RoleGuard": ({children}) => children,
      "@/api/dataClient": {},
      "@/components/inactive-dashboard/inactiveRevenueService": {},
      "@/components/links/ExternalIdLinks": {},
      "lucide-react": new Proxy({}, {get: () => () => null}),
      "@tanstack/react-query": {useQuery: () => query},
      "react-router-dom": {
        useLocation: () => ({search: "?category=rejection_reviews"}),
        Link: ({children}) => React.createElement("a", null, children)
      }
    };
    const empty = {
      range: {start: "2026-09-01", end: "2026-10-06"},
      inactive: {count: 0, revenue: 0}, boneyard: {count: 0, revenue: 0},
      collections: {rejection_reviews: 0, site_flags: 0, deletion_requests: 0, rmas: 0, material_orders: 0},
      decision_reasons: {}
    };
    for (const page of ["InactiveRevenueDashboard", "InactiveCollections"]) {
      const {default: Page} = await bundle(path.join("src", "pages", `${page}.jsx`), mocks);
      query = {isError: true, isPending: false, error: new Error("Could not load reviews: Access denied"), refetch: () => {}, isFetching: false};
      const failed = renderToStaticMarkup(React.createElement(Page));
      assert.match(failed, /role="alert"/);
      assert.match(failed, /Could not load reviews: Access denied/);
      assert.match(failed, /Try Again/);
      assert.ok(!failed.includes("Inactive quotes"));
      query = {...query, isFetching: true};
      assert.match(renderToStaticMarkup(React.createElement(Page)), /disabled=""[^>]*>Retrying/);
      query = {isPending: true, isError: false};
      assert.match(renderToStaticMarkup(React.createElement(Page)), /animate-spin/);
      query = {isPending: false, isError: false, data: page === "InactiveCollections" ? [] : empty};
      const success = renderToStaticMarkup(React.createElement(Page));
      assert.ok(!success.includes('role="alert"'));
      assert.match(success, page === "InactiveCollections" ? /No matching records/ : /Inactive Revenue Dashboard/);
    }
  } finally {
    delete globalThis.window;
  }
});

test("Base44 accepts local deletionRequests and rmas names used by the report", async () => {
  const names = [];
  const entities = Object.fromEntries(["QuoteDeletionRequest", "PVPanelRMA"].map(name => [
    name, {list: async () => { names.push(name); return []; }}
  ]));
  const {base44Adapter} = await bundle(path.join("src", "api", "adapters", "base44Adapter.js"), {
    "../base44Client": {base44: {entities}}
  });
  await base44Adapter.listLocalCollection("deletionRequests");
  await base44Adapter.listLocalCollection("rmas");
  assert.deepEqual(names, ["QuoteDeletionRequest", "PVPanelRMA"]);
});

test("desktop Base44 service uses the endpoint for summary, collections, and Boneyard", async () => {
  const calls = [];
  const range = {start: "2026-09-01", end: "2026-10-06"};
  const summary = {
    range, inactive: {count: 50, revenue: 120815.52953000004},
    boneyard: {count: 48, revenue: 112062.24207500003},
    collections: {rejection_reviews: 7, site_flags: 2, deletion_requests: 1, rmas: 9, material_orders: 16},
    decision_reasons: {no_customer_response: 10, cost: 2, scheduling: 2, homeowner_cancelled: 1, homeowner_declined: 1, other: 34}
  };
  const service = await bundle(path.join("src", "components", "inactive-dashboard", "inactiveRevenueService.js"), {
    "@/api/dataClient": {isBase44DataSource: true},
    "@/api/base44Client": {base44: {functions: {invoke: async (name, payload) => {
      calls.push({name, payload});
      return {data: payload.category ? {drilldown: {
        items: [{id: "hold", status: "on_hold"}, {id: "rejected", status: "ho_rejected"}],
        total: 2, next_offset: null
      }} : summary};
    }}}}
  });
  assert.deepEqual(await service.getInactiveSummary(range), summary);
  assert.equal((await service.getInactiveDrilldown({...range, category: "rmas"})).length, 2);
  assert.deepEqual(await service.getBoneyardQuotes(range.start, range.end), [{id: "hold", status: "on_hold"}]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.name === "getInactiveRevenueDashboard"));
  assert.equal(calls[2].payload.category, "homeowner_decisions");
});
