import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REFRESH_REASON_LABELS } from "@/hooks/useLocalSyncStatus";

const LEVEL_ICON = {
  info: <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
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
              ? "Could not reach the local webhook receiver on port 3001. Make sure webhook-receiver.cjs is running."
              : !isFinished
                ? "Checking the local webhook receiver for the latest imported data..."
                : (REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh check complete.")}
          </DialogDescription>
        </DialogHeader>

        {!unreachable && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Quotes on disk</span>
              <span className="font-medium text-slate-800">{lastAttempt?.storedQuoteCount ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Products on disk</span>
              <span className="font-medium text-slate-800">{lastAttempt?.storedProductCount ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Last import attempt</span>
              <span className="font-medium text-slate-800">
                {lastAttempt?.finishedAt ? new Date(lastAttempt.finishedAt).toLocaleTimeString() : "—"}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLogOpen(v => !v)}
          className="flex items-center justify-between w-full text-sm font-medium text-slate-600 hover:text-slate-900 transition"
        >
          <span>Diagnostic log ({events.length})</span>
          {logOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {logOpen && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-xs font-mono">
            {events.length === 0 && (
              <div className="p-3 text-slate-400 italic">No events yet.</div>
            )}
            {events.map(e => (
              <div key={e.seq} className={cn("flex items-start gap-2 p-2",
                e.level === 'error' && "bg-red-50",
                e.level === 'warn' && "bg-amber-50")}
              >
                {LEVEL_ICON[e.level] || LEVEL_ICON.info}
                <div className="flex-1 min-w-0">
                  <span className="text-slate-400">{new Date(e.time).toLocaleTimeString()}</span>{" "}
                  <span className="text-slate-700 break-words">{e.message}</span>
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
