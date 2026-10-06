import {Link} from "react-router-dom";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Table, TableBody, TableCell, TableHeader, TableRow} from "@/components/ui/table";
import SortableRecordHeaders from "./SortableRecordHeaders";
import {sortRecords} from "@/features/supervisorDashboard/recordSorting";
import {statusLabel} from "@/features/quoteDashboard/quoteLifecycle";
import {createPageUrl} from "@/utils";

const columns = [
  {key: "quote", label: "Quote", value: item => item.quote.quote_number || item.quote.id},
  {key: "case", label: "Case / Site", value: item => [item.quote.case_number, item.quote.site_id].filter(Boolean).join(" / ") || null},
  {key: "owner", label: "Owner", value: item => item.quote.owner_email || item.quote.created_by || null},
  {key: "activity", label: "Recorded activity in period", value: item => item.events.length ? Math.max(...item.events.map(event => event.at)) : null}
];

export default function QuoteContributingRecordsDialog({selection, onClose}) {
  const [sort, setSort] = useState(null);
  const sorted = sortRecords(selection?.records || [], columns, sort);
  return <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open) onClose(); }}>
    {selection && <DialogContent className="max-h-[80vh] max-w-5xl overflow-y-auto">
      <DialogHeader><DialogTitle>{selection.label} - Contributing records</DialogTitle>
        <DialogDescription>{selection.records.length} unique quotes in the selected reporting period. Each quote is counted once.</DialogDescription>
      </DialogHeader>
      <Table>
        <TableHeader><TableRow><SortableRecordHeaders columns={columns} sort={sort} onSort={setSort} /></TableRow></TableHeader>
        <TableBody>{sorted.map(({quote, events}) => <TableRow key={quote.id}>
          <TableCell><Link className="text-indigo-600 hover:underline" to={createPageUrl(`QuoteDetails?id=${encodeURIComponent(quote.id)}`)}>{quote.quote_number || quote.id}</Link></TableCell>
          <TableCell>{quote.case_number || "Unknown"} / {quote.site_id || "Unknown"}</TableCell>
          <TableCell>{quote.owner_email || quote.created_by || "Unknown"}</TableCell>
          <TableCell>{events.map((event, index) => <p key={index} className="text-xs">
            {new Date(event.at).toLocaleString()} - {event.kind === "created" ? "Created" : event.kind === "follow_up" ? "Follow-up" : `${statusLabel(event.from)} to ${statusLabel(event.to)}`} ({event.source})
          </p>)}</TableCell>
        </TableRow>)}
        {!selection.records.length && <TableRow><TableCell colSpan={4}>No contributing quotes in this period.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </DialogContent>}
  </Dialog>;
}
import {useState} from "react";
