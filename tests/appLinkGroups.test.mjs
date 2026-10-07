import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {sharedDashboardTilePath, readSharedDashboardPeriod} from "../src/features/supervisorDashboard/sharedDashboardPeriod.js";

const require = createRequire(import.meta.url);
const wrapper = ({children, className, ...props}) => React.createElement("div", {
  className, ...Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")))
}, children);
const components = new Proxy(wrapper, {
  get: (target, key) => target[key] ||
    (typeof key === "string" && /^[A-Z]/.test(key) && key !== "PropTypes" ? wrapper : undefined)
});

async function load(entry, mocks) {
  const result = await build({
    entryPoints: [path.resolve(entry)], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    alias: {"@": path.resolve("src")},
    plugins: [{name: "share-boundaries", setup(builder) {
      builder.onResolve({filter: /./}, args =>
        Object.hasOwn(mocks, args.path) || args.path.startsWith("@/components/") ||
        args.path.startsWith("@/api/") ? {path: args.path, external: true} : undefined);
    }}]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    id => Object.hasOwn(mocks, id) ? mocks[id] :
      id.startsWith("@/components/") ? components : id.startsWith("@/api/") ? {} : require(id),
    module, module.exports
  );
  return module.exports.default;
}

test("Quote Details renders stable selectable label/value groups, rows, totals, and sections", async () => {
  const quote = {
    id: "q1", site_id: "123", case_number: "456", picklist: "Project A",
    quote_number: "Q-123", status: "draft_without_internal", fst_count: 2,
    miles_traveled: 10, created_date: "2026-10-01", valid_until: "2026-11-01",
    paid_at_date: "2026-10-02", quote_requester: "Requester", created_by_email: "owner@example.com",
    last_follow_up_date: "2026-10-03", scope_of_work: "Scope text", notes: "Notes text",
    items: [{id: "item1", name: "Panel", quantity: 1, unit_price: 100, total: 100}],
    status_history: [{status: "draft_without_internal", changed_at: "2026-10-01", changed_by: "owner@example.com"}]
  };
  const mocks = {
    "@tanstack/react-query": {
      useQuery: ({queryKey}) => ({data: queryKey[0] === "quote" ? quote : queryKey[0] === "deletionRequest" ? null : [], isLoading: false}),
      useMutation: () => ({}), useQueryClient: () => ({})
    },
    "react-router-dom": {useNavigate: () => () => {}, useLocation: () => ({search: "?id=q1"}), Link: wrapper},
    "@/components/auth/RoleGuard": Object.assign(wrapper, {useUserRole: () => ({
      isAdmin: true, isApprover: true, isSubmitter: true, roles: ["approver"], user: {email: "owner@example.com"}
    })}),
    "@/utils": {createPageUrl: value => `/${value}`},
    "@/features/collab/collabApi": {hasCollabBridge: () => false},
    "@/components/links/ExternalIdLinks": {
      SiteIdLink: ({siteId}) => React.createElement("span", null, siteId),
      CaseNumberLink: ({caseNumber}) => React.createElement("span", null, caseNumber)
    },
    "lucide-react": new Proxy({}, {get: () => () => null}),
    sonner: {toast: {}}, "framer-motion": {motion: {div: wrapper}}
  };
  const Page = await load("src\\pages\\QuoteDetails.jsx", mocks);
  const html = renderToStaticMarkup(React.createElement(Page));
  for (const [field, label, value] of [
    ["site-id", "Site ID", "123"], ["case-number", "Case Number", "456"],
    ["picklist", "Project Picklist", "Project A"], ["fst-count", "FSTs Needed", "2"]
  ]) {
    assert.match(html, new RegExp(`data-enquote-share-target="quote:q1:${field}"[^>]*>[\\s\\S]*?${label}</p>[\\s\\S]*?${value}[\\s\\S]*?</div>\\s*</div>`));
  }
  for (const field of ["created", "valid-until", "paid-at", "requester", "creator",
    "last-follow-up", "pre-approval", "reporting", "items-subtotal", "labor",
    "travel", "mileage", "subtotal", "total", "scope", "notes", "version-history",
    "follow-up-history", "activity", "status-history"]) {
    assert.ok(html.includes(`data-enquote-share-target="quote:q1:${field}"`), field);
  }
  assert.match(html, /<tr[^>]*data-enquote-share-target="quote:q1:item:item1"/);
  assert.match(html, /data-enquote-share-target="quote:q1" data-enquote-share-scope="groups"/);
  assert.match(html, /class="quote-detail-fields"/);
});

test("dashboard grid attaches whole-tile targets and exact reporting routes to draggable wrappers", async () => {
  const range = {preset: "last_7_days", start: "2026-10-01", end: "2026-10-07"};
  const paths = [];
  const provided = {innerRef: () => {}, droppableProps: {}, draggableProps: {}, dragHandleProps: {}};
  const Grid = await load("src\\components\\supervisor\\TileGrid.jsx", {
    "@hello-pangea/dnd": {
      DragDropContext: wrapper,
      Droppable: ({children}) => children(provided),
      Draggable: ({children}) => children(provided, {})
    }
  });
  const html = renderToStaticMarkup(React.createElement(Grid, {
    tiles: [{id: "handled", label: "Handled", render: () => React.createElement("p", null, "123")}],
    onReorder: () => {},
    sharePath: id => {
      const route = sharedDashboardTilePath(id, range, "period_total");
      paths.push(route);
      return route;
    }
  }));
  assert.match(html, /data-enquote-share-target="supervisor-tile:handled"[^>]*>.*?<p>123<\/p><\/div>/);
  assert.deepEqual(readSharedDashboardPeriod(new URL(paths[0], "https://local.invalid").searchParams), {range, mode: "period_total"});
});

test("dashboard recipients use the shared period immediately and reveal hidden linked tiles without saving preferences", async () => {
  const saved = {preset: "single_day", start: "2026-09-01", end: "2026-09-01"};
  const range = {preset: "custom_range", start: "2026-10-01", end: "2026-10-07"};
  const route = sharedDashboardTilePath("improper_quote_requests", range, "latest_day");
  let params = new URL(route, "https://local.invalid").searchParams;
  let displayedRange, grid, saves = 0;
  globalThis.window = {localStorage: {getItem: () => JSON.stringify({hidden: ["improper_quote_requests"]})}};
  try {
    const Page = await load("src\\components\\supervisor\\DashboardOverview.jsx", {
      "@tanstack/react-query": {useQuery: ({queryKey}) => ({
        data: queryKey[0] === "report-tables-for-ops-overview" ? {} : [],
        isLoading: false, isError: false
      })},
      "react-router-dom": {useSearchParams: () => [params, () => {}]},
      "@/features/supervisorDashboard/useReportingPeriodPreference": {
        useReportingPeriodPreference: () => [saved, () => {saves++;}]
      },
      "@/components/supervisor/DashboardDateRange": props => {displayedRange = props.value; return null;},
      "@/components/supervisor/TileGrid": props => {grid = props; return null;},
      "lucide-react": new Proxy({}, {get: () => () => null}),
      sonner: {toast: {}}
    });
    renderToStaticMarkup(React.createElement(Page));
    assert.deepEqual(displayedRange, range);
    assert.ok(grid.tiles.some(tile => tile.id === "improper_quote_requests"));
    assert.equal(readSharedDashboardPeriod(new URL(grid.sharePath("improper_quote_requests"), "https://local.invalid").searchParams).mode, "latest_day");
    assert.equal(saves, 0, "merely opening the link cannot change a user's saved period");
    params = new URLSearchParams();
    renderToStaticMarkup(React.createElement(Page));
    assert.deepEqual(displayedRange, saved);
    assert.ok(!grid.tiles.some(tile => tile.id === "improper_quote_requests"), "normal tile visibility is unchanged");
  } finally {delete globalThis.window;}
});

test("shared rolling presets display the sender's exact dates even when opened on a later day", async () => {
  const inputs = [];
  const Control = await load("src\\components\\supervisor\\DashboardDateRange.jsx", {
    "lucide-react": new Proxy({}, {get: () => () => null}),
    "@/components/ui/input": {Input: props => {inputs.push(props.value); return null;}}
  });
  const value = {preset: "today", start: "2000-01-01", end: "2000-01-01"};
  renderToStaticMarkup(React.createElement(Control, {value, freezePresetDates: true}));
  assert.deepEqual(inputs, ["2000-01-01", "2000-01-01"]);
  inputs.length = 0;
  renderToStaticMarkup(React.createElement(Control, {value}));
  assert.ok(inputs[0] !== "2000-01-01", "ordinary preset editing keeps its existing date resolution");
});

test("both raw Auto-Drafter cases and generated quotes expose whole-tile share targets", async () => {
  const Tile = await load("src\\components\\autoDrafter\\AutoDrafterCaseTile.jsx", {
    "lucide-react": new Proxy({}, {get: () => () => null}),
    "framer-motion": {motion: {div: wrapper}}, sonner: {toast: {}},
    "@/features/supervisorDashboard/careEligibilityCache": {useCareEligibilityIndex: () => null}
  });

  for (const savedDraftRecord of [null, {quoteNumber: "AI-123", draft: {items: []}}]) {
    const html = renderToStaticMarkup(React.createElement(Tile, {
      row: {"Case Number": "456", "Site ID": "123"}, caseNumberCol: "Case Number",
      siteIdCol: "Site ID", savedDraftRecord
    }));
    assert.match(html, /data-enquote-share-target="auto-drafter-case:456"/);
    assert.match(html, /data-enquote-share-route="\/AutoDrafter\?shareCase=456"/);
  }
});

test("opened Auto-Drafter quotes use the shared detail spacing and field groups", async () => {
  const Page = await load("src\\components\\autoDrafter\\AutoDrafterDraftDetails.jsx", {
    "react-router-dom": {useNavigate: () => () => {}},
    "@/utils": {createPageUrl: value => `/${value}`},
    "lucide-react": new Proxy({}, {get: () => () => null}), sonner: {toast: {}}
  });
  const html = renderToStaticMarkup(React.createElement(Page, {
    caseNumber: "456", record: {siteId: "123", quoteNumber: "AI-123",
      draft: {customer: "Customer", items: [{id: "item1", name: "Panel", quantity: 1, unit_price: 100, total: 100}]}}
  }));
  assert.match(html, /class="quote-detail-fields"/);
  assert.match(html, /data-enquote-share-scope="groups"/);
  assert.match(html, /data-enquote-share-route="\/AutoDrafter\?draftCase=456"/);
  for (const field of ["site-id", "case-number", "customer", "address", "fst-count",
    "labor-hours", "miles-traveled", "generated", "items-subtotal", "labor", "travel",
    "mileage", "subtotal", "total", "scope", "notes"]) {
    assert.ok(html.includes(`data-enquote-share-target="auto-drafter-case:456:${field}"`), field);
  }
});
