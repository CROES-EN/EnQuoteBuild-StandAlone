import {useEffect, useState} from "react";
import {useAuth} from "@/lib/AuthContext";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, CloudOff, Info, Loader2, XCircle} from "lucide-react";
import {cn} from "@/lib/utils";
import {REFRESH_REASON_LABELS} from "@/hooks/useLocalSyncStatus";

const LEVEL_ICON = {
  info: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
  warn: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  error: <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
};

/**
 * Shows live pull/push progress and the settled result; refresh control remains in the
 * shared useLocalSyncStatus() hook (see Layout.jsx).
 */
export default function RefreshStatusDialog({ open, onOpenChange, phase, lastAttempt, progress, events = [], outboundStatus = null, fetchOutboundStatus }) {
  const [logOpen, setLogOpen] = useState(false);
  const unreachable = phase === "unreachable";
  const isFinished = phase === "success" || phase === "error" || unreachable;
  const inbound = progress?.inbound || lastAttempt;
  const outbound = progress?.outbound || lastAttempt?.outbound;
  const outboundActive = phase === "running" && progress?.stage === "outbound";
  const inboundActive = phase === "running" && progress?.stage === "inbound";

  // Refreshes outbound sync health once whenever the dialog actually opens, so it's
  // current when someone looks at it without polling continuously in the background.
  useEffect(() => {
    if (open) fetchOutboundStatus?.();
  }, [open, fetchOutboundStatus]);

  // Diagnostic report sending -- gathers real sync health on the main process side
  // (see main.cjs's "diagnostics:send" handler) and sends it to the configured host,
  // so troubleshooting can start from real, pre-analyzed data instead of manually
  // pasted terminal output.
  const { user } = useAuth();
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  async function handleSendDiagnosticReport() {
    setSendingReport(true);
    try {
      const bridge = globalThis.window?.enquoteLocal?.diagnostics;
      if (!bridge?.sendReport) throw new Error("Diagnostic reporting is only available in the desktop app.");
      const result = await bridge.sendReport(user?.email || "unknown");
      if (result?.ok) {
        setReportSent(true);
        setTimeout(() => setReportSent(false), 3000);
      }
    } catch {
      // Silent failure is acceptable here -- this is a best-effort troubleshooting
      // aid, not a critical path; the button simply stops showing "Sending..." and
      // never shows "Sent!" if it didn't succeed.
    } finally {
      setSendingReport(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!isFinished && !unreachable && <Loader2 className="w-4 h-4 animate-spin text-orange-500" />}
            {phase === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {phase === "error" && <XCircle className="w-4 h-4 text-red-500" />}
            {unreachable && <XCircle className="w-4 h-4 text-red-500" />}
            Syncing Quote Data
          </DialogTitle>
          <DialogDescription>
            {unreachable
              ? "Could not reach the shared data source. Previously loaded data may still be available."
              : phase === "error"
                ? "The refresh check failed. See the error details below."
                  : phase === "running" && outboundActive
                    ? "Sending saved quote changes to the team before checking for updates."
                    : phase === "running" && inboundActive
                      ? "Outgoing changes have been sent. Checking Cloudflare for quotes coming in."
                      : !isFinished
                        ? "Preparing to sync quotes in both directions..."
                    : (REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh check complete.")}
          </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-lg border border-border bg-secondary p-3 text-sm space-y-2">
              <h3 className="flex items-center gap-2 font-semibold text-foreground">
                <ArrowDown className="h-4 w-4 text-blue-600" />
                Quotes coming in
              </h3>
              <p className="text-muted-foreground">
                {inboundActive
                  ? "Checking Cloudflare for quote updates..."
                  : outboundActive
                    ? "Starts after outgoing quotes are sent."
                    : phase === "error"
                      ? "Incoming sync did not complete."
                      : inbound?.quoteAddedCount != null && inbound?.quoteUpdatedCount != null
                        ? `${inbound.quoteAddedCount} new, ${inbound.quoteUpdatedCount} updated`
                        : inbound?.quoteSnapshotCount != null
                          ? `Snapshot checked: ${inbound.quoteSnapshotCount} quote(s)`
                          : "No incoming quote details yet."}
              </p>
              {inbound?.quoteSnapshotCount != null && (
                <p className="text-xs text-muted-foreground">
                  {inbound.quoteSnapshotCount} quote(s) checked in the shared snapshot
                </p>
              )}
            </section>

            <section className="rounded-lg border border-border bg-secondary p-3 text-sm space-y-2">
              <h3 className="flex items-center gap-2 font-semibold text-foreground">
                <ArrowUp className="h-4 w-4 text-orange-600" />
                Quotes going out
              </h3>
              <p className="text-muted-foreground">
                {outboundActive
                  ? "Sending locally saved quote changes..."
                  : outbound?.configured === false
                    ? "Outbound sync is not configured on this device."
                    : outbound?.error
                      ? `Sync error: ${outbound.error}`
                      : outbound?.skipped === "already-running"
                        ? "Another outgoing sync is already in progress."
                        : outbound?.pushed != null
                          ? `${outbound.pushed} quote(s) sent`
                          : "No outgoing quote details yet."}
              </p>
              {outbound?.failed > 0 && (
                <p className="text-amber-700">{outbound.failed} quote(s) could not be sent and remain queued.</p>
              )}
              {outbound?.conflicts > 0 && (
                <p className="text-amber-700">{outbound.conflicts} quote(s) need conflict review.</p>
              )}
              {outbound?.pending > 0 && (
                <p className="text-muted-foreground">{outbound.pending} quote(s) still waiting to sync.</p>
              )}
            </section>
          </div>

          <div className="rounded-lg border border-border bg-secondary p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quotes on this device</span>
              <span className="font-medium text-foreground">{lastAttempt?.storedQuoteCount ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Products on this device</span>
              <span className="font-medium text-foreground">{lastAttempt?.storedProductCount ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last refresh check</span>
              <span className="font-medium text-foreground">
                {lastAttempt?.finishedAt ? new Date(lastAttempt.finishedAt).toLocaleTimeString() : "—"}
              </span>
            </div>
        </div>

        {lastAttempt?.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 break-words">
            {lastAttempt.error}
          </div>
        )}

        {outboundStatus && !outboundStatus.configured && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm flex items-start gap-2">
            <CloudOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-amber-800">
              Outbound sync to Base44 is not configured on this machine. Quotes created
              here will not reach the team until this is fixed.
            </span>
          </div>
        )}

        {outboundStatus && outboundStatus.configured && (
          <div className="rounded-lg border border-border bg-secondary p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Synced to Base44</span>
              <span className="font-medium text-foreground">{outboundStatus.synced} / {outboundStatus.total}</span>
            </div>
            {outboundStatus.pending > 0 && (
              <div className="flex items-center gap-1.5 text-amber-700">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{outboundStatus.pending} quote(s) waiting to sync</span>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setLogOpen(v => !v)}
          className="flex items-center justify-between w-full text-sm font-medium text-muted-foreground hover:text-foreground transition"
        >
          <span>Diagnostic log ({events.length})</span>
          {logOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {logOpen && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-card divide-y divide-slate-100 text-xs font-mono">
            {events.length === 0 && (
              <div className="p-3 text-muted-foreground italic">No events yet.</div>
            )}
            {events.map(e => (
              <div key={e.seq} className={cn("flex items-start gap-2 p-2",
                e.level === 'error' && "bg-red-50",
                e.level === 'warn' && "bg-amber-50")}
              >
                {LEVEL_ICON[e.level] || LEVEL_ICON.info}
                <div className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{new Date(e.time).toLocaleTimeString()}</span>{" "}
                  <span className="text-foreground break-words">{e.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendDiagnosticReport}
            disabled={sendingReport}
          >
            {sendingReport ? "Sending..." : reportSent ? "Sent!" : "Send Diagnostic Report"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
