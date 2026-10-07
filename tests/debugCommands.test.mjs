import assert from "node:assert/strict";
import test from "node:test";
import {DEBUG_COMMANDS, availableDebugCommands, formatDebugResult, runDebugCommand} from "../src/features/developerConsole/debugCommands.js";

function context(overrides = {}) {
  return {
    bridge: {
      diagnostics: {
        inspect: async command => command === "runtime" ? {appVersion: "1.3.0", architecture: "arm64"} : {sync: {lastResult: {ok: true}}},
        refreshSupervisor: async () => ({ok: true, appliedLocally: 2})
      },
      ui: {getInfo: async () => ({appVersion: "1.3.0", uiVersion: null}), check: async () => ({updated: false, reason: "up-to-date"})},
      admin: {policy: async () => ({ok: true, rolePages: null})},
      collections: {list: async name => name === "users" ? [{email: "heather@example.com", app_role: "approver", password: "must-not-leak"}] : []}
    },
    updater: {getState: async () => ({status: "error", message: "signature invalid"}), check: async () => ({ok: true})},
    user: {email: "heather@example.com", app_role: "approver"},
    listErrors: async () => [],
    queryClient: {invalidateQueries: async () => {}},
    ...overrides
  };
}

test("only exact allowlisted commands run, with no argument or code execution", async () => {
  for (const input of ["runtime extra", "eval(1)", "rm -rf", "permissions heather@example.com", "", "help; check-updates"]) {
    const result = await runDebugCommand(input, context());
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown command/);
  }
  assert.equal((await runDebugCommand(" HELP ", context())).data.length, DEBUG_COMMANDS.length);
});

test("permissions preserve intentional restrictions, overrides, denials and additional roles", async () => {
  for (const [user, expected] of [
    [{app_role: "approver"}, false],
    [{app_role: "approver", allow_pages: ["SupervisorDashboard"]}, true],
    [{app_role: "admin", deny_pages: ["SupervisorDashboard"]}, false],
    [{app_role: "submitter", additional_roles: ["admin"]}, true]
  ]) {
    const result = await runDebugCommand("permissions", context({user: {email: "heather@example.com", ...user}}));
    assert.equal(result.ok, true);
    assert.equal(result.data.session.canViewSupervisorDashboard, expected);
    assert.equal(result.data.syncedAccount.canViewSupervisorDashboard, false);
    assert.doesNotMatch(formatDebugResult(result), /must-not-leak|heather@example/);
  }
});

test("permissions distinguish cached policy and service/local role disagreement", async () => {
  const ctx = context();
  ctx.bridge.admin.policy = async () => ({
    ok: true, offline: true, rolePages: {approver: ["SupervisorDashboard"]},
    me: {email: "heather@example.com", app_role: "approver", deny_pages: ["SupervisorDashboard"]}
  });
  const result = await runDebugCommand("permissions", ctx);
  assert.match(result.data.policySource, /Cached/);
  assert.equal(result.data.session.canViewSupervisorDashboard, true);
  assert.equal(result.data.serviceAccount.canViewSupervisorDashboard, false);
});

test("released 1.3.0 bridges support UI-only diagnostics without newer native methods", async () => {
  const ctx = context();
  delete ctx.bridge.diagnostics;
  delete ctx.updater.check;
  const runtime = await runDebugCommand("runtime", ctx);
  assert.equal(runtime.ok, true);
  assert.equal(runtime.data.appVersion, "1.3.0");
  assert.equal(runtime.data.diagnosticMode, "UI-only (existing desktop bridges)");
  assert.equal(runtime.data.capabilities.installerCheck, false);
  assert.equal(runtime.data.capabilities.supervisorRefresh, false);
  assert.equal(runtime.data.unavailable.length, 5);
  const result = await runDebugCommand("diagnose", ctx);
  assert.equal(result.ok, true);
  assert.equal(result.data.complete, true);
  assert.equal(result.data.checks.length, 5);
  assert.equal(result.data.checks.find(check => check.command === "updates").ok, true);
  assert.equal(result.data.checks.find(check => check.command === "supervisor").ok, true);
  const commands = availableDebugCommands(ctx.bridge, ctx.updater);
  assert.equal(commands.find(item => item.name === "check-updates").available, false);
  assert.equal(commands.find(item => item.name === "refresh-supervisor").available, false);
  assert.equal(commands.find(item => item.name === "check-ui").available, true);
  assert.match((await runDebugCommand("refresh-supervisor", ctx)).error, /full desktop update/);
});

test("missing released bridges remain errors, not successful runtime defaults", async () => {
  const result = await runDebugCommand("diagnose", context({bridge: null, updater: null}));
  assert.equal(result.ok, false);
  assert.equal(result.data.checks.find(check => check.command === "runtime").ok, false);
  assert.match(result.data.checks.find(check => check.command === "runtime").error, /Installed version information is unavailable/);
});

test("supervisor summaries omit report contents and review-event identifiers", async () => {
  const ctx = context();
  ctx.bridge.collections.list = async name => name === "supervisorDailyMetrics"
    ? [{date: "2026-10-03"}, {date: "2026-10-01"}]
    : [
      {id: "workload", rows: [{name: "private row"}], sourceFileName: "private.xlsx", importedAt: "2026-10-03"},
      {id: "quote-request-review:private-case", reason: "private reason"}
    ];
  const result = await runDebugCommand("supervisor", ctx);
  assert.deepEqual(result.data.dailyMetrics, {count: 2, firstDate: "2026-10-01", lastDate: "2026-10-03"});
  assert.equal(result.data.reportTables[0].rowCount, 1);
  assert.doesNotMatch(formatDebugResult(result), /private/);
  ctx.bridge.collections.list = async () => ({invalid: true});
  assert.equal((await runDebugCommand("supervisor", ctx)).ok, false);
});

test("errors are bounded and redacted without full stack traces", async () => {
  const ctx = context({
    listErrors: async () => Array.from({length: 30}, () => ({
      source: "test", message: "Bearer topsecret token=abcdef email heather@example.com C:\\Users\\Heather\\data /Users/Heather/data",
      stack: "private stack"
    }))
  });
  const result = await runDebugCommand("errors", ctx);
  assert.equal(result.data.length, 20);
  assert.doesNotMatch(formatDebugResult(result), /topsecret|abcdef|heather@example|Heather|private stack/);
  assert.match(formatDebugResult({message: "x".repeat(40000)}), /\[Output truncated at 30000 characters\]$/);
});

test("read-only diagnose never invokes actions", async () => {
  const ctx = context();
  const forbidden = () => { throw new Error("read-only diagnostics invoked an action"); };
  ctx.bridge.ui.check = forbidden;
  ctx.bridge.diagnostics.refreshSupervisor = forbidden;
  ctx.updater.check = forbidden;
  ctx.queryClient.invalidateQueries = forbidden;
  assert.equal((await runDebugCommand("diagnose", ctx)).ok, true);
});

test("actions surface failures and refresh only after a successful reconcile", async () => {
  const ctx = context();
  let refreshCount = 0;
  ctx.queryClient.invalidateQueries = async () => {refreshCount += 1;};
  ctx.bridge.diagnostics.refreshSupervisor = async () => ({ok: false, error: "partial failure"});
  assert.equal((await runDebugCommand("refresh-supervisor", ctx)).error, "partial failure");
  assert.equal(refreshCount, 0);
  ctx.bridge.diagnostics.refreshSupervisor = async () => ({ok: true});
  assert.equal((await runDebugCommand("refresh-supervisor", ctx)).ok, true);
  assert.equal(refreshCount, 1);
  ctx.updater.check = async () => ({ok: false, error: "bad signature"});
  assert.equal((await runDebugCommand("check-updates", ctx)).ok, false);
  ctx.bridge.ui.check = async () => ({updated: false, reason: "no-credentials"});
  assert.equal((await runDebugCommand("check-ui", ctx)).ok, false);
  ctx.bridge.ui.check = async () => ({updated: false, reason: "different-app-version"});
  assert.equal((await runDebugCommand("check-ui", ctx)).data.reason, "different-app-version");
  ctx.queryClient.invalidateQueries = async () => {throw new Error("query failed");};
  assert.equal((await runDebugCommand("refresh-view", ctx)).error, "query failed");
});
