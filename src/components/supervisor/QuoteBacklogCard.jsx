import {Layers} from "lucide-react";
import {getStatusLabel} from "@/constants/quoteStatuses";

export default function QuoteBacklogCard({query, date, missingDate, onViewRecords}) {
  const snapshot = query.data?.snapshot;
  return <div className="rounded-xl border border-border bg-secondary p-4">
    <Layers className="h-5 w-5 text-fuchsia-600" />
    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quote Backlog</p>
    {missingDate && <p data-backlog-missing-date={missingDate} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
      No snapshot was saved for {missingDate} (daily history only exists from the day the backlog service went live). Showing today instead.
    </p>}
    {query.isError ? <div role="alert" className="mt-2 text-sm text-destructive">
      {query.error.message} <button type="button" className="underline" onClick={() => query.refetch()}>Retry</button>
    </div> : query.isLoading ? <p role="status">Loading backlog...</p> : !snapshot ?
      <p className="mt-2 text-sm text-muted-foreground">N/A - no snapshot captured for {date}.</p> : <>
        <p className="mt-1 text-3xl font-bold text-foreground">{snapshot.count}</p>
        <p className="mt-1 text-xs text-muted-foreground">{date} · {query.data.live ? "Live today" : "Frozen daily snapshot"} · Mountain Time</p>
        <dl className="mt-3 space-y-1 text-xs">
          {Object.entries(snapshot.statusCounts).map(([status, count]) =>
            <div key={status} className="flex justify-between gap-2"><dt>{getStatusLabel(status) || status}</dt><dd className="font-semibold">{count}</dd></div>)}
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">Captured {new Date(snapshot.capturedAt).toLocaleString("en-US", {timeZone: snapshot.timeZone})} MT</p>
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">View contributing records</button>
      </>}
    <p className="mt-2 text-[11px] text-muted-foreground">Shared SLA-alert backlog; closing date of the reporting period.</p>
  </div>;
}
