import {Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {BACKLOG_FLOW_DAYS, useBacklogFlow} from "@/features/supervisorDashboard/useSupervisorInsights";

const shortDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {month: "short", day: "numeric", timeZone: "UTC"});

function FlowTooltip({active, payload}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const list = quotes => quotes.slice(0, 6).join(", ") + (quotes.length > 6 ? ` +${quotes.length - 6} more` : "");
  return <div className="rounded-md border border-border bg-popover p-3 text-xs shadow-md space-y-1 max-w-xs">
    <p className="font-semibold">{shortDate(row.date)}</p>
    {row.opening === null ? <p>No earlier snapshot to compare.</p> : <>
      <p>Opening backlog: {row.opening}{row.comparedTo && row.comparedTo !== row.previousDay ? ` (from ${shortDate(row.comparedTo)})` : ""}</p>
      <p className="text-amber-700">+{row.added} new{row.addedQuotes.length ? `: ${list(row.addedQuotes)}` : ""}</p>
      <p className="text-emerald-700">-{row.left} left the backlog{row.leftQuotes.length ? `: ${list(row.leftQuotes)}` : ""}</p>
    </>}
    <p className="font-medium">Closing backlog: {row.closing}</p>
    <p className="text-rose-700">Overdue: {row.overdue}</p>
  </div>;
}

export default function BacklogFlowChart({endDate}) {
  const query = useBacklogFlow(endDate);
  const rows = (query.data || []).map((row, index, all) => ({...row, previousDay: index ? all[index - 1].date : null, label: shortDate(row.date)}));
  const latest = rows.at(-1);
  return <Card className="border-border" data-backlog-flow-chart>
    <CardContent className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Daily Quote Backlog snapshots for the {BACKLOG_FLOW_DAYS} days ending {endDate ? shortDate(endDate) : "the selected date"}.
        Each day is compared with the previous captured day: <span className="text-amber-700">new</span> quotes entered the backlog,
        quotes that <span className="text-emerald-700">left</span> were completed, moved past backlog statuses, or deleted.
        Days without a captured snapshot are skipped.
      </p>
      {query.isError ? <div role="alert" className="text-sm text-destructive">
        {query.error.message} <Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
        : query.isLoading ? <p role="status" className="text-sm">Loading backlog history...</p>
        : !rows.length ? <p className="text-sm text-muted-foreground">No Quote Backlog snapshots have been captured for this period yet.</p>
        : <>
          {latest && <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[["Opening", latest.opening ?? "-"], ["New", latest.added === null ? "-" : `+${latest.added}`],
              ["Left", latest.left === null ? "-" : `-${latest.left}`], ["Closing", latest.closing], ["Overdue", latest.overdue]]
              .map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-secondary p-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label} · {shortDate(latest.date)}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>)}
          </div>}
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={rows} margin={{left: 0, right: 10, top: 10}}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{fontSize: 11}} />
              <YAxis allowDecimals={false} tick={{fontSize: 11}} />
              <Tooltip content={<FlowTooltip />} />
              <Legend wrapperStyle={{fontSize: 12}} />
              <Bar dataKey="added" name="New" fill="#f59e0b" isAnimationActive={false} />
              <Bar dataKey="left" name="Left backlog" fill="#10b981" isAnimationActive={false} />
              <Line dataKey="closing" name="Closing backlog" stroke="hsl(var(--primary))" strokeWidth={2} dot isAnimationActive={false} />
              <Line dataKey="overdue" name="Overdue" stroke="#e11d48" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </>}
    </CardContent>
  </Card>;
}
