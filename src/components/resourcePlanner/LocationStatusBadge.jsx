import {Badge} from "@/components/ui/badge";
import {LOCATION_STATUS} from "@/lib/fstLocation";

const TONES = {
  good: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warn: "bg-amber-100 text-amber-800 border-amber-300",
  bad: "bg-rose-100 text-rose-700 border-rose-200",
  muted: "bg-muted text-muted-foreground border-border"
};

export default function LocationStatusBadge({ status, className = "" }) {
  const meta = LOCATION_STATUS[status] || LOCATION_STATUS.pending;
  return (
    <Badge variant="outline" title={meta.hint} className={`px-1.5 py-0 text-[10px] font-medium ${TONES[meta.tone]} ${className}`}>
      {meta.label}
    </Badge>
  );
}
