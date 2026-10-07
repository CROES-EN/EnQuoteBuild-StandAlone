import {useState} from "react";
import {TriangleAlert} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import ImproperRequestRecords from "@/components/autoDrafter/ImproperRequestRecords";
import {useQuoteRequestReviews} from "@/features/autoDrafter/useQuoteRequestReviews";
import {improperRequestMetric} from "@/features/autoDrafter/improperQuoteRequests";
import {AGGREGATION_MODE_OPTIONS} from "@/features/supervisorDashboard/periodAggregation";
import {formatNumber} from "@/features/supervisorDashboard/format";

export default function ImproperQuoteRequestsTile({range, mode}) {
  const query = useQuoteRequestReviews();
  const [open, setOpen] = useState(false);
  const metric = !query.isLoading && !query.isError ? improperRequestMetric(query.data || [], range, mode) : null;
  return <>
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><TriangleAlert className="h-4 w-4" /></div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Improper Quote Requests</p>
      {query.isError ? <div role="alert" className="mt-2 text-sm text-destructive">
        Unable to load request reviews: {query.error.message}
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>Try Again</Button>
      </div> : query.isLoading ? <p role="status" className="mt-1 text-sm text-muted-foreground">Loading request reviews...</p> : <>
        <p className="mt-1 text-3xl font-bold text-foreground">{formatNumber(Math.round(metric.value * 100) / 100)}</p>
        <Badge variant="outline" className="mt-2 border-border bg-card text-[10px] text-muted-foreground">{AGGREGATION_MODE_OPTIONS.find(option => option.value === mode)?.label}</Badge>
        {metric.date && <p className="text-[11px] text-muted-foreground">As of {metric.date}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">Marked in Auto-Drafter; includes restored requests</p>
        <button type="button" className="mt-2 text-xs font-medium text-indigo-600 hover:underline" onClick={() => setOpen(true)}>View contributing records</button>
      </>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Improper Quote Requests - Contributing Records</DialogTitle>
          <DialogDescription>
            {range.start} through {range.end}. One row per case marked in this period; undo does not erase marking history.
            Daily Average counts unique cases per day, including zero-activity days. Latest Day uses the period end.
            Times use your local time zone. Shared records appear after desktop sync.
          </DialogDescription>
        </DialogHeader>
        {query.isError ? <p role="alert">{query.error.message}</p> : <ImproperRequestRecords records={metric?.records || []} />}
      </DialogContent>
    </Dialog>
  </>;
}
