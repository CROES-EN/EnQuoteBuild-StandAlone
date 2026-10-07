import {canAccessPage, rolesForUser, toRoleList} from "../../lib/rolePageAccess.js";

export const DEBUG_COMMANDS = Object.freeze([
  {name: "help", description: "List supported commands."},
  {name: "runtime", description: "Installed version and bridge capabilities; extra native details when available."},
  {name: "updates", description: "Installer state and downloaded signed UI version (does not check the network)."},
  {name: "permissions", description: "Current account's Supervisor Dashboard access and synced role."},
  {name: "supervisor", description: "Local dashboard counts, date coverage, sync state and large-table health."},
  {name: "errors", description: "Last 20 recorded app errors (redacted; no stack traces)."},
  {name: "diagnose", description: "Run all read-only checks; continue if an individual check fails."},
  {name: "check-updates", description: "Native-only: check installer feed; updater may download an available update.", action: true},
  {name: "check-ui", description: "Check/download a compatible signed UI update; does not reload.", action: true},
  {name: "refresh-supervisor", description: "Native-only: reconcile shared Supervisor data and refetch active queries.", action: true},
  {name: "refresh-view", description: "Refetch active queries without clearing cache or changing files.", action: true}
]);

export function availableDebugCommands(bridge, updater) {
  return DEBUG_COMMANDS.map(command => {
    const available = command.name === "check-updates"
      ? typeof updater?.check === "function"
      : command.name === "refresh-supervisor"
        ? typeof bridge?.diagnostics?.refreshSupervisor === "function"
        : true;
    return {
      ...command,
      available,
      ...(!available ? {unavailableReason: "Requires a newer desktop bridge; not included in the 1.3.0 UI hotfix."} : {})
    };
  });
}

export function redactDiagnosticText(value) {
  const redacted = String(value)
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/((?:token|password|secret|api[_-]?key|authorization|cookie)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:[A-Z]:[\\/]+Users[\\/]+|\/Users\/)[^\\/\s"]+/gi, "[user-home]");
  return redacted.length > 30000
    ? `${redacted.slice(0, 30000)}\n[Output truncated at 30000 characters]`
    : redacted;
}

export function formatDebugResult(result) {
  return redactDiagnosticText(JSON.stringify(result, null, 2));
}

async function bounded(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostic timed out. The underlying request may still be running; inspect state before retrying.")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function requireMethod(object, method, label) {
  if (typeof object?.[method] !== "function") {
    throw new Error(`${label} is unavailable in this installed app. A full desktop update is required; a UI hotfix cannot add an Electron bridge.`);
  }
  return (...args) => object[method](...args);
}

function requireSuccess(result) {
  if (result?.ok !== true) throw new Error(result?.error || result?.reason || "The operation did not report success.");
  return result;
}

function arrayResult(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned invalid data.`);
  return value;
}

function accessSummary(user, policy) {
  return {
    signedIn: Boolean(user?.email),
    roles: rolesForUser(user),
    allowPages: toRoleList(user?.allow_pages),
    denyPages: toRoleList(user?.deny_pages),
    canViewSupervisorDashboard: Boolean(user?.email) && canAccessPage(user, "SupervisorDashboard", policy)
  };
}

export async function runDebugCommand(input, context) {
  const command = String(input || "").trim().toLowerCase();
  const definition = DEBUG_COMMANDS.find(item => item.name === command);
  if (!definition) return {ok: false, command, error: "Unknown command. Type help. Arguments, shell commands and JavaScript are not supported."};
  const {bridge, updater, user, listErrors, queryClient} = context;
  try {
    const data = await bounded(async () => {
      switch (command) {
        case "help":
          return availableDebugCommands(bridge, updater);
        case "runtime": {
          if (typeof bridge?.diagnostics?.inspect === "function") return bridge.diagnostics.inspect("runtime");
          const ui = await requireMethod(bridge?.ui, "getInfo", "Installed version information")();
          return {
            appVersion: ui?.appVersion || null,
            downloadedUiVersion: ui?.uiVersion || null,
            diagnosticMode: "UI-only (existing desktop bridges)",
            capabilities: {
              collections: typeof bridge?.collections?.list === "function",
              accessPolicy: typeof bridge?.admin?.policy === "function",
              signedUiCheck: typeof bridge?.ui?.check === "function",
              installerState: typeof updater?.getState === "function",
              installerCheck: typeof updater?.check === "function",
              supervisorRefresh: typeof bridge?.diagnostics?.refreshSupervisor === "function"
            },
            unavailable: [
              "OS/process architecture and Mac installation location",
              "Data-folder filesystem permissions",
              "Actual loaded UI version versus staged/downloaded UI",
              "Last heartbeat telemetry and retained installer errors",
              "Native Supervisor reconciliation status and separate-file inspection"
            ],
            note: "These fields are unavailable, not failed checks. This UI hotfix cannot change Electron or repair installer updating. Run the same commands on both Macs to compare versions, capabilities, access and local data."
          };
        }
        case "updates": {
          const ui = await requireMethod(bridge?.ui, "getInfo", "Signed UI information")();
          const installer = await requireMethod(updater, "getState", "Installer update state")();
          return {
            ui, installer,
            note: "UI updates require an exact installed-app version match. Older desktop versions need an installer, not a newer version's UI bundle. A null installer state on old builds does not prove updates are healthy."
          };
        }
        case "permissions": {
          const policy = requireSuccess(await requireMethod(bridge?.admin, "policy", "Access policy")());
          const users = arrayResult(await requireMethod(bridge?.collections, "list", "Local user collection")("users"), "Users");
          const storedUser = users.find(candidate => String(candidate?.email || "").toLowerCase() === String(user?.email || "").toLowerCase());
          return {
            session: accessSummary(user, policy),
            syncedAccount: storedUser ? accessSummary(storedUser, policy) : null,
            serviceAccount: policy.me ? accessSummary(policy.me, policy) : null,
            policySource: policy.offline ? "Cached policy (offline; may be stale)" : "Live desktop access policy",
            note: "Explicit deny wins over allow. Approvers are not granted Supervisor Dashboard by default. An admin must grant page access; this console never changes roles or bypasses access."
          };
        }
        case "supervisor": {
          const list = requireMethod(bridge?.collections, "list", "Supervisor collections");
          const [metrics, tables] = await Promise.all([
            list("supervisorDailyMetrics").then(value => arrayResult(value, "Daily metrics")),
            list("supervisorReportTables").then(value => arrayResult(value, "Report tables"))
          ]);
          const dates = metrics.map(record => record?.date).filter(date => typeof date === "string").sort();
          const native = bridge?.diagnostics?.inspect
            ? await bridge.diagnostics.inspect("supervisor")
            : {warning: "Native sync/large-table diagnostics need a full desktop update. Local collection counts are still available."};
          return {
            dailyMetrics: {count: metrics.length, firstDate: dates[0] || null, lastDate: dates.at(-1) || null},
            reportTables: tables.filter(record => !String(record?.id).startsWith("quote-request-review:")).map(record => ({
              id: record.id,
              rowCount: Array.isArray(record.rows) ? record.rows.length : null,
              importedAt: record.importedAt || null,
              updatedAt: record.updated_date || null
            })),
            ...native,
            note: "Counts describe this machine, not successful team sync. Empty results can also reflect no imports or a reporting period without data."
          };
        }
        case "errors":
          return arrayResult(await listErrors(), "Error log").slice(0, 20).map(error => ({
            source: error.source, message: error.message, occurredAt: error.occurredAt
          }));
        case "diagnose": {
          const checks = ["runtime", "updates", "permissions", "supervisor", "errors"];
          const results = await Promise.all(checks.map(name => runDebugCommand(name, context)));
          return {complete: results.every(result => result.ok), checks: results};
        }
        case "check-updates":
          return requireSuccess(await requireMethod(updater, "check", "Installer update check")());
        case "check-ui": {
          const result = await requireMethod(bridge?.ui, "check", "Signed UI update check")();
          if (!result || result.error || result.reason === "error") throw new Error(result?.error || "UI update check failed.");
          if (["no-credentials", "not-packaged"].includes(result.reason)) throw new Error(`UI update check did not run: ${result.reason}.`);
          return result;
        }
        case "refresh-supervisor": {
          const result = requireSuccess(await requireMethod(bridge?.diagnostics, "refreshSupervisor", "Supervisor refresh")());
          await queryClient.invalidateQueries({}, {throwOnError: true});
          return result;
        }
        case "refresh-view":
          await queryClient.invalidateQueries({}, {throwOnError: true});
          return {ok: true, note: "Active queries were refetched. No cache or data was deleted."};
        default:
          throw new Error("Unsupported command.");
      }
    }, definition.action || command === "diagnose" ? 120000 : 15000);
    return {ok: command === "diagnose" ? data.complete : true, command, data};
  } catch (error) {
    return {ok: false, command, error: redactDiagnosticText(error?.message || error)};
  }
}
