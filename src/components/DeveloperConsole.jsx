import {useCallback, useEffect, useState} from "react";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {AlertOctagon, AlertTriangle, Database, Info, KeyRound, RefreshCw, Trash2, Users} from "lucide-react";
import {clearErrors, listErrors} from "@/features/developerConsole/errorLog";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {AdminResetPasswordButton} from "@/features/developerConsole/AdminPasswordReset.jsx";

const REPORT_SEVERITY_ORDER = { critical: 0, known_issue: 1, needs_investigation: 2, warning: 3, info: 4 };
const REPORT_SEVERITY_LABEL = {
  critical: "Critical",
  known_issue: "Known Issue",
  needs_investigation: "Needs Investigation",
  warning: "Warning",
  info: "Info"
};
const REPORT_SEVERITY_STYLE = {
  critical: "bg-red-100 text-red-700",
  known_issue: "bg-orange-100 text-orange-700",
  needs_investigation: "bg-amber-100 text-amber-700",
  warning: "bg-yellow-100 text-yellow-700",
  info: "bg-slate-100 text-slate-600"
};

function SeverityBadge({ severity }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_SEVERITY_STYLE[severity] || REPORT_SEVERITY_STYLE.info}`}>
      {REPORT_SEVERITY_LABEL[severity] || severity}
    </span>
  );
}

/**
 * Discreet, hidden-behind-Shift+` panel for app developers - shows every error/finding
 * detected from any part of the application, unified into one place:
 *
 *   1. App Errors - uncaught render crashes (ErrorBoundary), global JS errors
 *      (window.onerror), and unhandled promise rejections - persisted via errorLog.js so
 *      they survive after DevTools is closed (this is a genuinely new capability - none of
 *      these were persisted anywhere before tonight; ErrorBoundary only ever did a
 *      console.error(), and there was no global window.onerror/unhandledrejection listener
 *      anywhere in the app, confirmed via a full-codebase search before building this).
 *
 *   2. Sync Events - this machine's own recent sync/refresh log (reuses the SAME `events`
 *      already tracked by useLocalSyncStatus.js/RefreshStatusDialog - passed in as a prop
 *      rather than opening a second, duplicate subscription to the same data).
 *
 *   3. Teammate Diagnostic Reports - reports submitted by teammates via "Send Diagnostic
 *      Report" (RefreshStatusDialog), read from diagnostic-reports/ via the new
 *      diagnostics:listReports IPC channel. Deliberately reads each report's own `findings`
 *      field (computed correctly on the SENDER's machine before submission) -- NOT
 *      `report.analysis` (the receiver-side re-analysis field) -- since that field is
 *      currently computed against an incomplete payload shape (the sender's report object
 *      never includes the raw outboundQueue/hasEnvKey/hasRemoteSyncConfig inputs
 *      analyzeAll() needs) and would show misleading, incorrect results if displayed. This
 *      is a known, confirmed gap in webhook-receiver.cjs's handleDiagnosticReport(), not
 *      something this component works around silently - flagged here so it isn't
 *      forgotten if `report.analysis` is ever fixed and someone wants to switch to it later.
 */
export default function DeveloperConsole({
  open,
  onOpenChange,
  syncEvents = [],
  // Who is currently signed in, and whether they're an admin - passed down
  // from wherever <DeveloperConsole /> is rendered (per this file's own
  // comments, that's Layout.jsx). Defaults keep this component safe even if
  // the caller hasn't been updated yet: the Manage Users tab simply won't
  // show up until isCurrentUserAdmin is actually wired to a real value.
  currentUserEmail = null,
  isCurrentUserAdmin = false
}) {
  const [appErrors, setAppErrors] = useState([]);
  const [reports, setReports] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("errors");
  const queryClient = useQueryClient();

    const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [errors, reportsRes, presenceRes, usersRes] = await Promise.all([
        listErrors(),
        globalThis.window?.enquoteLocal?.diagnostics?.listReports?.() ?? Promise.resolve({ ok: false, reports: [] }),
        globalThis.window?.enquoteLocal?.presence?.list?.() ?? Promise.resolve({ ok: false, sessions: [] }),
        // ASSUMPTION (verify against your real preload.cjs): collections:list
        // exposed as window.enquoteLocal.collections.list(name), matching the
        // same namespaced convention as diagnostics/presence above. Defensive
        // optional-chaining means this silently returns [] instead of
        // crashing if the bridge method doesn't exist under this exact name.
        globalThis.window?.enquoteLocal?.collections?.list?.("users") ?? Promise.resolve([])
      ]);
      setAppErrors(errors);
      setReports(reportsRes?.ok ? (reportsRes.reports || []) : []);
      setSessions(presenceRes?.ok ? (presenceRes.sessions || []) : []);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadAll();
  }, [open, loadAll]);

  async function handleClearErrors() {
    await clearErrors();
    loadAll();
  }

  // Clears React Query's ENTIRE in-memory cache and immediately refetches every
  // currently-active query, so any page showing stale cached data is guaranteed to
  // reflect exactly what's on disk right now. This is a safe, non-destructive action -
  // it never deletes any real data, it only forces a fresh re-read of it. Useful
  // specifically for "make sure data is showing properly" situations, per explicit
  // request.
  async function handleClearCache() {
    // Forces a fresh pull from Cloudflare's entity-snapshot endpoint FIRST (per
    // Cloudflare's own guidance) - only re-reading the local data file would just
    // show whatever was already there, not a genuinely fresh snapshot. Gracefully
    // skipped if this bridge method isn't available for any reason.
    try {
      const syncBridge = globalThis.window?.enquoteLocal?.sync;
      if (syncBridge?.forceEntitySnapshot) {
        await syncBridge.forceEntitySnapshot();
      }
    } catch (error) {
      console.error("Failed to force a fresh entity-snapshot pull:", error);
    }
    queryClient.clear();
    await queryClient.refetchQueries();
    toast.success("Cache cleared - pulled a fresh snapshot and refreshed all data.");
    loadAll();
  }

  // Flattens every report's findings into one severity-sorted list, tagging each with which
  // teammate/machine it came from so the same finding type from multiple people is still
  // distinguishable rather than looking like duplicates.
  const flattenedFindings = reports
    .flatMap((report) =>
      (report.findings || []).map((finding) => ({
        ...finding,
        senderEmail: report.senderEmail,
        sentAt: report.sentAt,
        appVersion: report.appVersion
      }))
    )
    .sort((a, b) => (REPORT_SEVERITY_ORDER[a.severity] ?? 99) - (REPORT_SEVERITY_ORDER[b.severity] ?? 99));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-indigo-600" />
            Developer Console
          </DialogTitle>
          <DialogDescription>
            Every error/finding detected from any part of the application - app errors, sync events, and teammate diagnostic reports.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border pb-2">
                    {[
            { key: "errors", label: `App Errors (${appErrors.length})` },
            { key: "sync", label: `Sync Events (${syncEvents.length})` },
            { key: "reports", label: `Teammate Reports (${flattenedFindings.length})` },
            { key: "presence", label: `Who's Online (${sessions.length})` },
            // Hidden entirely (not just disabled) for non-admins - matches
            // the "hide, don't just disable" requirement discussed earlier.
            ...(isCurrentUserAdmin ? [{ key: "admin", label: `Manage Users (${users.length})` }] : [])
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === tab.key ? "bg-indigo-100 text-indigo-700" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={loadAll} disabled={loading} title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleClearCache} title="Clear cache & refresh all data">
              <Database className="w-4 h-4" />
            </Button>
            {activeTab === "errors" && (
              <Button variant="ghost" size="icon" onClick={handleClearErrors} title="Clear app error log">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {activeTab === "errors" && (
            appErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-4 text-center">No app errors recorded. Good sign.</p>
            ) : (
              appErrors.map((err) => (
                <div key={err.id} className="rounded-lg border border-border bg-card p-3 text-xs font-mono">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-red-600">{err.source}</span>
                    <span className="text-muted-foreground">{new Date(err.occurredAt).toLocaleString()}</span>
                  </div>
                  <p className="text-foreground break-words">{err.message}</p>
                  {err.componentStack && (
                    <pre className="mt-2 whitespace-pre-wrap text-muted-foreground text-[10px]">{err.componentStack.trim()}</pre>
                  )}
                </div>
              ))
            )
          )}

          {activeTab === "sync" && (
            syncEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-4 text-center">No sync events yet.</p>
            ) : (
              syncEvents.map((e) => (
                <div
                  key={e.seq}
                  className={`flex items-start gap-2 p-2 rounded-lg text-xs font-mono ${
                    e.level === "error" ? "bg-red-50" : e.level === "warn" ? "bg-amber-50" : "bg-card border border-border"
                  }`}
                >
                  {e.level === "error" ? (
                    <AlertOctagon className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  ) : e.level === "warn" ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-muted-foreground">{new Date(e.time).toLocaleTimeString()}</span>{" "}
                    <span className="text-foreground break-words">{e.message}</span>
                  </div>
                </div>
              ))
            )
          )}

          {activeTab === "reports" && (
            flattenedFindings.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-4 text-center">No teammate diagnostic reports found.</p>
            ) : (
              flattenedFindings.map((finding, idx) => (
                <div key={idx} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-[11px] text-muted-foreground">
                      {finding.senderEmail} - v{finding.appVersion} - {new Date(finding.sentAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-foreground">{finding.summary}</p>
                </div>
              ))
            )
          )}

                    {activeTab === "presence" && (
            sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-4 text-center">No one else is currently signed in.</p>
            ) : (
              sessions
                .slice()
                .sort((a, b) => new Date(b.signedInAt) - new Date(a.signedInAt))
                .map((session) => (
                  <div key={session.email} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
                    <Users className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{session.name || session.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Signed in {new Date(session.signedInAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
            )
          )}

          {activeTab === "admin" && isCurrentUserAdmin && (
            users.length === 0 ? (
              <p className="text-sm text-muted-foreground italic p-4 text-center">No local users found.</p>
            ) : (
              users
                .slice()
                .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)))
                .map((user) => (
                  <div key={user.email} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <KeyRound className="w-4 h-4 text-indigo-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{user.name || user.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {user.email} - {user.app_role || "no role set"}
                        </p>
                      </div>
                    </div>
                    <AdminResetPasswordButton
                      targetEmail={user.email}
                      targetName={user.name}
                      currentUserEmail={currentUserEmail}
                      isCurrentUserAdmin={isCurrentUserAdmin}
                    />
                  </div>
                ))
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}