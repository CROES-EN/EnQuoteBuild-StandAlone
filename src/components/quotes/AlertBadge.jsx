import { AlertCircle, AtSign, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const LEVEL_STYLES = {
  green: "bg-emerald-50 border-emerald-300 text-emerald-700",
  yellow: "bg-amber-50 border-amber-300 text-amber-700",
  orange: "bg-orange-50 border-orange-300 text-orange-700",
  red: "bg-red-50 border-red-300 text-red-700",
};

export function SLAAlertBadge({ alert, onClear }) {
  if (!alert) return null;

  if (alert.isClearable) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear?.(); }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold leading-tight bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors"
        title={alert.description || "Click to clear"}
      >
        <CheckCircle className="w-3 h-3 shrink-0" />
        <span>Clear</span>
      </button>
    );
  }

  const style = LEVEL_STYLES[alert.level] || LEVEL_STYLES.yellow;
  return (
    <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold leading-tight", style)}>
      <AlertCircle className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[100px]">{alert.name}</span>
      {alert.timeLabel && (
        <span className="font-bold whitespace-nowrap">· {alert.timeLabel}</span>
      )}
    </div>
  );
}

export function MentionBadge({ priority = "yellow", message, mentionedBy }) {
  const style = LEVEL_STYLES[priority] || LEVEL_STYLES.yellow;
  const tooltip = mentionedBy
    ? `${mentionedBy.split("@")[0]}: ${message || ""}`
    : message || "";
  return (
    <div
      className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold leading-tight", style)}
      title={tooltip}
    >
      <AtSign className="w-3 h-3 shrink-0" />
      <span>Mentioned</span>
    </div>
  );
}