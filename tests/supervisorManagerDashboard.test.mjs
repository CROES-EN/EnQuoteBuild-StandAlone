import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {ALL_PAGES, canAccessPage} from "../src/lib/rolePageAccess.js";

const require = createRequire(import.meta.url);
const previousWindow = globalThis.window;
test.before(() => { globalThis.window = {self: null, top: null}; });
test.after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

async function loadDashboard(search = "", dailyMetricsLoading = false, errors = {}) {
  const queries = [];
  let tabs;
  let feedback;
  const mockPanel = () => React.createElement("p", null, "Existing supervisor panel");
  const mocks = {
    "lucide-react": new Proxy({}, {get: () => () => null}),
    "@tanstack/react-query": {
      useQueryClient: () => ({invalidateQueries() {}}),
      useQuery: options => {
        queries.push(options);
        const key = options.queryKey[0];
        return {
          isLoading: key === "supervisor-daily-metrics" && dailyMetricsLoading,
          isError: Boolean(errors[key]),
          error: errors[key] ? new Error(errors[key]) : null,
          refetch() {},
          data: key === "quotes"
            ? [{id: "q1", status: "rejected"}, {id: "q2", status: "approved"}]
            : key === "manager-reviews" ? [{review_status: "completed"}] : []
        };
      }
    },
    "react-router-dom": {
      Link: ({children, to}) => React.createElement("a", {href: to}, children),
      useSearchParams: () => [
        new URLSearchParams(search),
        (update, options) => {
          tabs.updatedSearch = update(new URLSearchParams(search));
          tabs.options = options;
        }
      ]
    },
    "@/components/auth/RoleGuard": ({children}) => children,
    "@/api/dataClient": {
      getQuotes: async () => [{id: "current"}, {id: "old", is_current_version: false}],
      getAllQuoteActivities: async () => [{id: "audit-1", quote_id: "current", action: "updated"}],
      getReviews: async () => [{id: "review"}]
    },
    "@/features/supervisorDashboard/opsMetricsStore": {
      isElectronBacked: () => false,
      listDailyMetrics: async () => []
    },
    "@/features/supervisorDashboard/lastImportedFile": {
      canOpenLocalFiles: () => false,
      getLastImportedFile: () => null,
      openLastImportedFile: async () => ({ok: true})
    },
    "@/components/ui/tabs": {
      Tabs: ({children, value, onValueChange}) => {
        tabs = {value, onValueChange};
        return React.createElement("div", null, children);
      },
      TabsList: ({children}) => React.createElement("div", null, children),
      TabsTrigger: ({children, value}) => React.createElement("button", {
        role: "tab", "aria-selected": tabs.value === value
      }, children),
      TabsContent: ({children, value}) => tabs.value === value ? children : null
    }
  };
  for (const name of [
    "DailySnapshotReport", "DashboardOverview",
    "NiceRawDataPanel", "EscalationsTabPanel", "CareSubscriptionsTabPanel",
    "SfdcQuotesTabPanel", "ReportInventory", "ConsolidatedReportsPanel"
  ]) mocks[`@/components/supervisor/${name}`] = mockPanel;
  for (const name of ["ImportReportDialog", "DailyMetricsForm"]) {
    mocks[`@/components/supervisor/${name}`] = ({open}) => open ? mockPanel() : null;
  }
  for (const name of [
    "RejectionRateChart", "CommonRejectionReasons", "TurnaroundByTeam", "RejectionReasonBreakdown"
  ]) mocks[`@/components/manager/${name}`] = () => null;
  mocks["@/components/manager/FeedbackThemes"] = props => {
    feedback = props;
    return null;
  };
  const output = await build({
    entryPoints: [path.join("src", "pages", "SupervisorDashboard.jsx")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", alias: {"@": path.resolve("src")},
    plugins: [{
      name: "dashboard-test-boundaries",
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
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  return {html, queries, tabs, feedback};
}

test("Supervisor defaults to Executive Overview and preserves all existing tabs", async () => {
  const {html, tabs, queries} = await loadDashboard();
  assert.equal(tabs.value, "dashboard");
  for (const label of [
    "Executive Overview", "Quote Dashboard", "NICE Raw Data", "Report Data",
    "Escalations", "Care Subscriptions", "SFDC-Quotes", "Daily Snapshot Report", "Report Inventory"
  ]) assert.ok(html.includes(label), label);
  assert.match(html, /Existing supervisor panel/);
  assert.ok(!queries.some(query => query.queryKey[0] === "quotes"));
});

test("Old Manager tab links open Quote Dashboard without waiting for local reports", async () => {
  const {html, queries, feedback, tabs} = await loadDashboard("?tab=manager-dashboard&keep=yes", true);
  assert.equal(tabs.value, "quote-dashboard");
  assert.match(html, /<h2[^>]*>Quote Dashboard<\/h2>/);
  assert.match(html, /Status changes in period/);
  assert.match(html, /Quote activity over time/);
  assert.match(html, /Current quote pipeline/);
  assert.match(html, /Status-to-status turnaround/);
  assert.match(html, /Time in current stage/);
  assert.match(html, /Quote explorer/);
  assert.ok(!html.includes("<table"), "Default dashboard must be chart-first, not a wall of tables");
  assert.match(html, /Turnaround Time by Submitter/);
  assert.ok(!html.includes("Existing supervisor panel"));
  assert.ok(!html.includes("own local store"));
  assert.ok(!html.includes("this browser only"));
  assert.equal(feedback.canEdit, true);
  assert.equal(feedback.quotes.length, 2);
  assert.equal(feedback.reviews.length, 1);
  const quoteQuery = queries.find(query => query.queryKey[0] === "quotes");
  assert.deepEqual(quoteQuery.queryKey, ["quotes", "lifecycle"]);
  assert.deepEqual(await quoteQuery.queryFn(), [{id: "current"}]);
  const activityQuery = queries.find(query => query.queryKey[0] === "quoteActivity");
  assert.deepEqual(await activityQuery.queryFn(), [{id: "audit-1", quote_id: "current", action: "updated"}]);
  const reviewQuery = queries.find(query => query.queryKey[0] === "manager-reviews");
  assert.deepEqual(await reviewQuery.queryFn(), [{id: "review"}]);
  tabs.onValueChange("snapshot-report");
  assert.equal(tabs.updatedSearch.get("tab"), "snapshot-report");
  assert.equal(tabs.updatedSearch.get("keep"), "yes");
  assert.deepEqual(tabs.options, {replace: true});
});

test("Supervisor tab URLs open the requested panel and unknown tabs use Executive Overview", async () => {
  assert.equal((await loadDashboard("?tab=quote-dashboard")).tabs.value, "quote-dashboard");
  assert.equal((await loadDashboard("?tab=report-data")).tabs.value, "report-data");
  assert.equal((await loadDashboard("?tab=unknown")).tabs.value, "dashboard");
});

test("Manager navigation is consolidated and uses Supervisor permissions", async () => {
  const [app, layout] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/Layout.jsx", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/ManagerDashboard" element=\{\s*<Navigate to="\/SupervisorDashboard\?tab=quote-dashboard" replace \/>/);
  assert.match(app, /path="\/QuoteDashboard" element=\{\s*<Navigate to="\/SupervisorDashboard\?tab=quote-dashboard" replace \/>/);
  assert.ok(!layout.includes('page: "ManagerDashboard"'));
  assert.ok(layout.includes('page: "SupervisorDashboard"'));
  assert.ok(!ALL_PAGES.includes("ManagerDashboard"));
  assert.equal(canAccessPage({
    app_role: "submitter", allow_pages: ["SupervisorDashboard"], deny_pages: ["ManagerDashboard"]
  }, "SupervisorDashboard"), true);
  assert.equal(canAccessPage({
    app_role: "submitter", allow_pages: ["ManagerDashboard"]
  }, "SupervisorDashboard"), false);
});

test("Quote failures show retry rather than zero totals; review failures do not hide lifecycle data", async () => {
  const failed = await loadDashboard("?tab=quote-dashboard", false, {quotes: "Quote service unavailable"});
  assert.match(failed.html, /role="alert"/);
  assert.match(failed.html, /Quote service unavailable/);
  assert.match(failed.html, /Try Again/);
  assert.ok(!failed.html.includes("Current quotes in scope"));
  const reviewFailure = await loadDashboard("?tab=quote-dashboard", false, {"manager-reviews": "Reviews unavailable"});
  assert.match(reviewFailure.html, /Current quotes in scope/);
  assert.match(reviewFailure.html, /Retry Reviews/);
  assert.equal(reviewFailure.feedback, undefined);
  const auditFailure = await loadDashboard("?tab=quote-dashboard", false, {quoteActivity: "Audit service unavailable"});
  assert.match(auditFailure.html, /Audit service unavailable/);
  assert.ok(!auditFailure.html.includes("Current quotes in scope"));
});
