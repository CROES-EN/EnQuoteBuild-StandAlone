import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import {setImmediate} from "node:timers";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";

const require = createRequire(import.meta.url);
const requests = [
  {
    id: "newer",
    externalResponseId: "response-new",
    submittedAt: "2026-10-08T10:00:00.000Z",
    lastUpdatedAt: "2026-10-08T10:00:00.000Z",
    status: "New",
    subscriptionId: "SUB-2",
    siteId: "SITE-2",
    customerName: "Jordan Customer",
    requestorName: "Morgan Requestor",
    requestorEmail: "morgan@example.com",
    requestorDepartment: "Customer Care",
    refundAmountRequested: 25.5,
    refundType: "Partial Refund",
    leadershipApprovalRequired: true
  },
  {
    id: "older",
    externalResponseId: "response-old",
    submittedAt: "2026-10-01T10:00:00.000Z",
    lastUpdatedAt: "2026-10-01T10:00:00.000Z",
    status: "Under Review",
    subscriptionId: "SUB-1",
    siteId: "SITE-1",
    customerName: "Casey Customer",
    requestorName: "Riley Requestor",
    requestorEmail: "riley@example.com",
    requestorDepartment: "Sales",
    refundAmountRequested: 100,
    refundType: "Full Refund",
    leadershipApprovalRequired: false
  }
];

function dom(tag) {
  return ({children, className, ...props}) => React.createElement(tag, {...props, className}, children);
}

const controlMocks = {
  "@/components/ui/label": {Label: dom("label")},
  "@/components/ui/checkbox": {
    Checkbox: ({checked}) => React.createElement("input", {type: "checkbox", checked, readOnly: true})
  },
  "@/components/ui/select": {
    Select: ({value, children}) => React.createElement("div", {"data-select-value": value}, children),
    SelectTrigger: ({children, ...props}) => React.createElement("button", {...props, role: "combobox"}, children),
    SelectValue: () => null,
    SelectContent: dom("div"),
    SelectItem: ({value, children}) => React.createElement("div", {role: "option", "data-value": value}, children)
  }
};

async function loadComponent(entryPoint, mocks, exports = false) {
  const output = await build({
    entryPoints: [path.join("src", entryPoint)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
    alias: {"@": path.resolve("src"), "enquote-refund-form": path.resolve("shared", "refundForm.cjs")},
    plugins: [{
      name: "refund-ui-test-mocks",
      setup(builder) {
        builder.onResolve({filter: /.*/}, (args) =>
          Object.hasOwn(mocks, args.path) ? {path: args.path, external: true} : null
        );
      }
    }]
  });
  const module = {exports: {}};
  new Function("require", "module", "exports", output.outputFiles[0].text)(
    (name) => mocks[name] || require(name),
    module,
    module.exports
  );
  return exports ? module.exports : module.exports.default;
}

test("Refund Requests renders the operational queue and writes edits back with explicit partial-save errors", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {enquoteLocal: {refundRequests: {syncWorkbook() {}}}};
  t.after(() => {globalThis.window = previousWindow;});
  const mutations = [], notices = [];
  let syncFailure = false, syncCalls = 0;
  const mocks = {
    ...controlMocks,
    "@tanstack/react-query": {
      useQuery: ({queryKey}) => ({
        data: queryKey[0] === "refund-requests" ? requests :
          queryKey[0] === "refund-workbook-status" ? {configured: true, path: "shared.xlsx"} : {conflicts: [], serverConflicts: []},
        isLoading: false, isError: false, isFetching: false, refetch() {}
      }),
      useMutation: (options) => {mutations.push(options); return {mutateAsync: async () => {}, isPending: false};},
      useQueryClient: () => ({invalidateQueries: async () => {}})
    },
    "lucide-react": {AlertCircle: dom("svg"), RefreshCw: dom("svg")},
    "sonner": {toast: {
      success: (message) => notices.push(message), error: (message) => notices.push(message),
      warning: (message) => notices.push(message)
    }},
    "@/components/auth/RoleGuard": {useUserRole: () => ({roles: ["invoicer"], isAdmin: false, isSuperAdmin: false})},
    "@/features/collab/collabApi": {refundRequestsApi: {
      list: async () => requests, update: async () => {},
      syncWorkbook: async () => {
        syncCalls++;
        if (syncFailure) throw new Error("Workbook locked");
        return {conflicts: [], serverConflicts: []};
      }
    }},
    "@/components/ui/button": {Button: dom("button")},
    "@/components/ui/card": {Card: dom("section"), CardContent: dom("div")},
    "@/components/ui/dialog": {
      Dialog: dom("div"),
      DialogContent: dom("div"),
      DialogDescription: dom("p"),
      DialogFooter: dom("footer"),
      DialogHeader: dom("header"),
      DialogTitle: dom("h2")
    },
    "@/components/ui/input": {Input: dom("input")},
    "@/components/ui/textarea": {Textarea: dom("textarea")}
  };
  const Component = await loadComponent("components/enphaseCare/RefundRequests.jsx", mocks);
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /Refund Requests \(2\)/);
  assert.match(html, /Search refund requests/);
  assert.match(html, /Request Status/);
  assert.match(html, /Leadership Approval/);
  assert.ok(html.indexOf("SUB-2") < html.indexOf("SUB-1"), "newer submission is rendered first");
  assert.match(html, /Required/);
  assert.match(html, /\$25\.50/);
  assert.match(html, /Change status for response-new/);
  assert.match(html, /Jordan Customer/);
  assert.doesNotMatch(html, />NEW</);
  for (const status of ["Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled"]) {
    assert.ok(html.includes(`<option value="${status}"`), "card offers every tracker status");
  }
  assert.doesNotMatch(html, /<table/);
  assert.equal((html.match(/role="combobox"/g) || []).length, 4);
  assert.equal((html.match(/data-select-value="all"/g) || []).length, 4);
  for (const id of ["status", "department", "type", "approval"]) {
    assert.ok(html.includes(`for="refund-filter-${id}"`), "filter label targets its dropdown");
    assert.ok(html.includes(`id="refund-filter-${id}"`), "filter dropdown has an accessible label");
  }
  for (const value of ["Submitted", "Under Review", "Approved", "Denied", "Completed", "Cancelled", "Customer Care", "Sales", "Full Refund", "Partial Refund", "yes", "no"]) {
    assert.ok(html.includes(`data-value="value:${value}"`), "filter option retains its original value");
  }
  assert.doesNotMatch(html, /data-value=""/);
  assert.doesNotMatch(html, /Refund CSV report source|Change CSV source|Import CSV now/);
  assert.doesNotMatch(html, /Change workbook|Connect workbook/);
  const saved = mutations.at(-1).onSuccess;
  await saved();
  assert.equal(syncCalls, 1);
  assert.match(notices.at(-1), /updated in EnQuote and the Excel tracker/);
  syncFailure = true;
  await saved();
  assert.equal(syncCalls, 2);
  assert.match(notices.at(-1), /Saved to EnQuote, but Excel sync is pending: Workbook locked/);
});

test("Enphase Care hides refund features and ignores stale refund deep links", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    enquoteLocal: {
      refundRequests: {
        list() {},
        submit() {},
        update() {},
        onChanged() {}
      }
    }
  };
  const mocks = {
    "react-router-dom": {useSearchParams: () => [new URLSearchParams("tab=refund-requests"), () => {}]},
    "@/components/ui/tabs": {
      Tabs: ({value, children}) => React.createElement("div", {"data-active-tab": value}, children),
      TabsContent: ({children}) => React.createElement("section", null, children),
      TabsList: dom("nav"),
      TabsTrigger: ({children}) => React.createElement("button", null, children)
    },
    "@/components/ui/card": {
      Card: dom("section"),
      CardContent: dom("div"),
      CardHeader: dom("header"),
      CardTitle: dom("h2")
    },
    "@/components/auth/RoleGuard": ({children}) => children,
    "@/components/supervisor/ReportDataTable": () => React.createElement("div", null, "Subscriptions table"),
    "@/components/supervisor/CareSubscriptionsTabPanel": {DEFAULT_SUMMARY_FIELDS: []},
    "@/features/supervisorDashboard/importedTableStore": {
      CARE_ACTIVE_TYPE: "active-care",
      getActiveCareTable: async () => ({rows: []})
    },
    "@/components/enphaseCare/RefundRequests": () => React.createElement("div", null, "Refund queue"),
    "@/components/enphaseCare/RefundRequestForm": () => React.createElement("div", null, "Request form")
  };
  try {
    const Component = await loadComponent("pages/EnphaseCare.jsx", mocks);
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.match(html, /Active Subscriptions/);
    assert.doesNotMatch(html, /Submit Request|Refund Requests|Refund queue|Request form/);
    assert.match(html, /data-active-tab="subscriptions"/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Enphase Care preserves refund UI behavior when explicitly re-enabled", async () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  const mocks = {
    "../../shared/refundFeature.json": {enabled: true},
    "react-router-dom": {useSearchParams: () => [new URLSearchParams("tab=refund-requests"), () => {}]},
    "@/components/ui/tabs": {
      Tabs: dom("div"),
      TabsContent: ({children}) => React.createElement("section", null, children),
      TabsList: dom("nav"),
      TabsTrigger: ({children}) => React.createElement("button", null, children)
    },
    "@/components/ui/card": {
      Card: dom("section"),
      CardContent: dom("div"),
      CardHeader: dom("header"),
      CardTitle: dom("h2")
    },
    "@/components/auth/RoleGuard": ({children}) => children,
    "@/components/supervisor/ReportDataTable": () => React.createElement("div", null, "Subscriptions table"),
    "@/components/supervisor/CareSubscriptionsTabPanel": {DEFAULT_SUMMARY_FIELDS: []},
    "@/features/supervisorDashboard/importedTableStore": {
      CARE_ACTIVE_TYPE: "active-care",
      getActiveCareTable: async () => ({rows: []})
    },
    "@/components/enphaseCare/RefundRequests": () => React.createElement("div", null, "Refund queue"),
    "@/components/enphaseCare/RefundRequestForm": () => React.createElement("div", null, "Request form")
  };
  try {
    const Component = await loadComponent("pages/EnphaseCare.jsx", mocks);
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.match(html, /Active Subscriptions/);
    assert.match(html, /Refund Requests/);
    assert.match(html, /not enabled in this running EnQuote session/);
    assert.match(html, /Submit Request/);
    assert.doesNotMatch(html, /Refund queue/);
    assert.match(html, /Request form/);
  } finally {
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  }
});

test("Enphase Care native form retains the live questions and a single Excel destination", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {enquoteLocal: {refundRequests: {
    trackerStatus: async () => ({ok: true}), connectTracker() {}, submitToTracker() {}, retryTracker() {}
  }}};
  const mocks = {
    ...controlMocks,
    "@tanstack/react-query": {
      useMutation: () => ({mutate() {}, isPending: false}),
      useQueryClient: () => ({invalidateQueries: async () => {}})
    },
    "sonner": {toast: {success() {}, error() {}}},
    "@/components/auth/RoleGuard": {useUserRole: () => ({user: {full_name: "Alex Requestor"}})},
    "@/features/collab/collabApi": {refundRequestsApi: {submit: async () => ({})}},
    "@/components/ui/button": {Button: dom("button")},
    "@/components/ui/card": {
      Card: dom("section"),
      CardContent: dom("div"),
      CardDescription: dom("p"),
      CardHeader: dom("header"),
      CardTitle: dom("h2")
    },
    "@/components/ui/input": {Input: dom("input")},
    "@/components/ui/textarea": {Textarea: dom("textarea")}
  };
  try {
    const Component = await loadComponent("components/enphaseCare/RefundRequestForm.jsx", mocks);
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.match(html, /Enphase Care Cancel\/Refund Request Tracking/);
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /When should the Enphase Care plan be canceled\?/);
    assert.match(html, /Is a refund also being requested\?/);
    for (const option of ["Immediately", "At the end of the current term", "No refund", "Full refund", "Partial refund"]) {
      assert.ok(html.includes(option));
    }
    assert.match(html, /Shared tracker: automatic connection/);
    assert.doesNotMatch(html, /Choose CSV destination|Change CSV source|Change workbook|Connect shared workbook/);
    assert.doesNotMatch(html, /Customer email address/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("native form preserves branching and reconnects automatically without browsing", async () => {
  const previousWindow = globalThis.window;
  let trackerAvailable = false, statusChecks = 0, effect, poll, pollInterval, cleared = false;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  globalThis.window = {enquoteLocal: {refundRequests: {
    trackerStatus: async () => {
      statusChecks++;
      return trackerAvailable ? {ok: true, configured: true, path: "shared.xlsx", pending: false} :
        {ok: false, configured: false, error: "Waiting for OneDrive"};
    }, submitToTracker() {}, retryTracker() {}
  }}};
  const states = [];
  let cursor = 0;
  const errors = [];
  try {
    const Component = await loadComponent("components/enphaseCare/RefundRequestForm.jsx", {
      react: {...React, useEffect(callback) {effect = callback;}, useRef: () => ({current: null}), useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value) => {states[index] = typeof value === "function" ? value(states[index]) : value;}];
      }},
      "@tanstack/react-query": {useQueryClient: () => ({invalidateQueries: async () => {}})},
      "@/components/auth/RoleGuard": {useUserRole: () => ({user: {email: "processor@example.com"}})},
      "sonner": {toast: {success() {}, error: (message) => errors.push(message)}},
      "@/components/ui/button": {Button: dom("button")},
      "@/components/ui/input": {Input: dom("input")},
      "@/components/ui/textarea": {Textarea: dom("textarea")},
      "@/components/ui/card": {
        Card: dom("section"), CardContent: dom("div"), CardDescription: dom("p"),
        CardHeader: dom("header"), CardTitle: dom("h2")
      }
    });
    const render = () => {cursor = 0; return Component();};
    const find = (node, predicate) => {
      if (!React.isValidElement(node)) return null;
      if (predicate(node)) return node;
      for (const child of React.Children.toArray(node.props.children)) {
        const match = find(child, predicate);
        if (match) return match;
      }
      return null;
    };
    const choose = (name, value) => {
      find(render(), (node) => node.props.name === name && node.props.value === value).props.onChange();
    };
    choose("refundChoice", "Full refund");
    assert.match(renderToStaticMarkup(render()), /Services completed/);
    assert.doesNotMatch(renderToStaticMarkup(render()), /Customer email address/);
    choose("servicesCompleted", "Yes");
    assert.match(renderToStaticMarkup(render()), /Customer email address/);
    choose("refundReason", "Other");
    assert.match(renderToStaticMarkup(render()), /Add reason if the &quot;Other&quot; is selected/);
    assert.match(renderToStaticMarkup(render()), /Detailed explanation of the refund request/);
    choose("refundChoice", "No refund");
    assert.doesNotMatch(renderToStaticMarkup(render()), /Services completed/);
    assert.doesNotMatch(renderToStaticMarkup(render()), /Leadership Approval|Requestor Department|Refund amount \(USD\)/);
    assert.deepEqual(errors, []);
    globalThis.setInterval = (callback, interval) => {poll = callback; pollInterval = interval; return 123;};
    globalThis.clearInterval = (timer) => {assert.equal(timer, 123); cleared = true;};
    const cleanup = effect();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(statusChecks, 1);
    assert.equal(pollInterval, 30_000);
    assert.match(renderToStaticMarkup(render()), /Waiting for OneDrive/);
    assert.equal(find(render(), (node) => node.props.type === "submit").props.disabled, true);
    trackerAvailable = true;
    await poll();
    assert.equal(statusChecks, 2);
    assert.match(renderToStaticMarkup(render()), /shared.xlsx/);
    assert.doesNotMatch(renderToStaticMarkup(render()), /Waiting for OneDrive/);
    assert.equal(find(render(), (node) => node.props.type === "submit").props.disabled, false);
    cleanup();
    assert.equal(cleared, true);
  } finally {
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
