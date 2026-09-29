import {useState} from "react";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Loader2, XCircle} from "lucide-react";
import {cn} from "@/lib/utils";
import {REFRESH_REASON_LABELS} from "@/hooks/useLocalSyncStatus";

const LEVEL_ICON = {
  info: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />,
  warn: <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
  error: <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
};

/**
 * Optional deep-dive view into a refresh check: current phase, stored counts, and a
 * collapsible diagnostic event log. Purely presentational - all polling/triggering lives
 * in the shared useLocalSyncStatus() hook (see Layout.jsx), so this can be opened at any
 * time (mid-refresh or after it settles) without starting a second, independent poll.
 */
export default function RefreshStatusDialog({ open, onOpenChange, phase, lastAttempt, events = [] }) {
  const [logOpen, setLogOpen] = useState(false);
  const unreachable = phase === "unreachable";
  const isFinished = phase === "success" || phase === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!isFinished && !unreachable && <Loader2 className="w-4 h-4 animate-spin text-orange-500" />}
            {phase === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {phase === "error" && <XCircle className="w-4 h-4 text-red-500" />}
            {unreachable && <XCircle className="w-4 h-4 text-red-500" />}
            Refreshing Quote Data
          </DialogTitle>
          <DialogDescription>
            {unreachable
              ? "No New Quote's available."
              : !isFinished
                ? "Checking the local webhook receiver for the latest imported data..."
                : (REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh check complete.")}
          </DialogDescription>
        </DialogHeader>

        {!unreachable && (
          <div className="rounded-lg border border-border bg-secondary p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quotes on disk</span>
              <span className="font-medium text-foreground">{lastAttempt?.storedQuoteCount ?? "â€”"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Products on disk</span>
              <span className="font-medium text-foreground">{lastAttempt?.storedProductCount ?? "â€”"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last import attempt</span>
              <span className="font-medium text-foreground">
                {lastAttempt?.finishedAt ? new Date(lastAttempt.finishedAt).toLocaleTimeString() : "â€”"}
              </span>
            </div>
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
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
