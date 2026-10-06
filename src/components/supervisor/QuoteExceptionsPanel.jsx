import {useMemo, useState} from "react";
import {Link} from "react-router-dom";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Table, TableBody, TableCell, TableHeader, TableRow} from "@/components/ui/table";
import SortableRecordHeaders from "./SortableRecordHeaders";
import {sortRecords} from "@/features/supervisorDashboard/recordSorting";
import {buildQuoteExceptions} from "@/features/supervisorDashboard/quoteExceptions";
import {durationLabel, statusLabel} from "@/features/quoteDashboard/quoteLifecycle";
import {createPageUrl} from "@/utils";

const columns = [
  {key: "quote", label: "Quote / case / site", value: item => item.quote.quote_number || item.quote.id},
  {key: "owner", label: "Owner", value: item => item.quote.owner_email || item.quote.created_by || null},
  {key: "status", label: "Current status", value: item => item.quote.status ? statusLabel(item.quote.status) : null},
  {key: "age", label: "Stage age", value: item => item.currentHours},
  {key: "reason", label: "Review reason", value: item => item.reason}
];

function ExceptionList({group}) {
  const [visible, setVisible] = useState(10);
  const [sort, setSort] = useState(null);
  const sorted = sortRecords(group.rows, columns, sort);
  if (!group.rows.length) return null;
  return <section className="space-y-2">
    <h4 className="font-semibold">{group.title}</h4>
    <p className="text-xs text-muted-foreground">{group.description}</p>
    <Table>
      <TableHeader><TableRow><SortableRecordHeaders columns={columns} sort={sort} onSort={next => { setSort(next); setVisible(10); }} /></TableRow></TableHeader>
      <TableBody>{sorted.slice(0, visible).map(item => <TableRow key={item.quote.id}>
        <TableCell><Link className="text-primary underline" to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(item.quote.id)}`)}>{item.quote.quote_number || item.quote.id}</Link>
          <p className="text-xs text-muted-foreground">{item.quote.case_number || "Unknown"} / {item.quote.site_id || "Unknown"}</p>
        </TableCell>
        <TableCell>{item.quote.owner_email || item.quote.created_by || "Unknown"}</TableCell>
        <TableCell>{statusLabel(item.quote.status)}</TableCell>
        <TableCell>{durationLabel(item.currentHours)}</TableCell>
        <TableCell className="max-w-md text-xs">{item.reason}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {visible < group.rows.length && <Button size="sm" variant="outline" onClick={() => setVisible(count => count + 10)}>Show more {group.title.toLowerCase()}</Button>}
  </section>;
}

export default function QuoteExceptionsPanel({report, alertRows, loading, error, onRetry}) {
  const groups = useMemo(() => report ? buildQuoteExceptions(report.timelines, alertRows) : [], [report, alertRows]);
  return <Card>
    <CardHeader><CardTitle>Quote exceptions</CardTitle>
      <p className="text-sm text-muted-foreground">Live review queue, independent of the reporting period and report filter. Each quote appears once: overdue actions first, then history gaps, then other open quotes. On-hold and reporting-excluded quotes are omitted.</p>
    </CardHeader>
    <CardContent className="space-y-6">
      {error ? <div role="alert"><p>Unable to load quote exceptions: {error.message}</p><Button variant="outline" onClick={onRetry}>Retry quote exceptions</Button></div>
        : loading ? <p role="status">Loading quote exceptions...</p>
          : groups.every(group => !group.rows.length) ? <p className="text-sm text-muted-foreground">No quote exceptions or open quotes to review.</p>
            : groups.map(group => <ExceptionList key={group.key} group={group} />)}
      <Link className="text-sm text-primary underline" to={createPageUrl("SupervisorDashboard?tab=quote-dashboard")}>Open Quote Dashboard for full charts and history</Link>
    </CardContent>
  </Card>;
}
