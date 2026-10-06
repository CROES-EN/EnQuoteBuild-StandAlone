import {FileText, CheckCircle2} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {formatNumber} from "@/features/supervisorDashboard/format";
import {AGGREGATION_MODE_OPTIONS, AGGREGATION_MODES} from "@/features/supervisorDashboard/periodAggregation";

export default function QuotePeriodActivityTile({metric, report, loading, error, onRetry, onViewRecords, display, mode = AGGREGATION_MODES.PERIOD_TOTAL}) {
  const created = metric === "created";
  const label = created ? "Quotes Created" : "Quotes Worked";
  const Icon = created ? FileText : CheckCircle2;
  return <div className="rounded-xl border border-border bg-secondary p-4">
    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${created ? "bg-violet-50 text-violet-600" : "bg-teal-50 text-teal-600"}`}>
      <Icon className="h-4 w-4" />
    </div>
    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    {error ? <div role="alert" className="mt-2 space-y-2">
      <p className="text-sm text-destructive">Unable to load quote activity: {error.message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try Again</Button>
    </div> : loading ? <p role="status" className="mt-1 text-sm text-muted-foreground">Loading quote activity...</p> : <>
      <p className="mt-1 text-3xl font-bold text-foreground">{formatNumber(display ? Math.round(display.value * 100) / 100 : created ? report.newQuotes : report.workedQuotes)}</p>
      <Badge variant="outline" className="mt-2 border-border bg-card text-[10px] text-muted-foreground">{AGGREGATION_MODE_OPTIONS.find(option => option.value === mode)?.label}</Badge>
      {display?.date && <p className="text-[11px] text-muted-foreground">As of {display.date}</p>}
    </>}
    <p className="mt-1 text-[11px] text-muted-foreground">Live from EnQuote</p>
    {!error && !loading && <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">View contributing records</button>}
  </div>;
}
