import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Table, TableBody, TableCell, TableHeader, TableRow} from "@/components/ui/table";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import SortableRecordHeaders from "@/components/supervisor/SortableRecordHeaders";
import {sortRecords} from "@/features/supervisorDashboard/recordSorting";

const columns = [
  {key: "caseNumber", label: "Case"},
  {key: "siteId", label: "Site"},
  {key: "firstMarkedAt", label: "First marked in period"},
  {key: "at", label: "Last marked in period"},
  {key: "reviewer", label: "Reviewer"},
  {key: "reason", label: "Reason"},
  {key: "markingCount", label: "Marking events"},
  {key: "currentState", label: "Current state"}
].map(column => ({...column, value: record => column.key === "markingCount" ? record.markingCount ?? record.activeMarkIds?.length ?? 1 : column.key === "currentState" ? record.currentState || "Improper" : column.key === "firstMarkedAt" ? record.firstMarkedAt || record.at : record[column.key]}));

export default function ImproperRequestRecords({records, onUndo, busy = false, search = ""}) {
  const [sort, setSort] = useState({key: "at", direction: "desc"});
  const displayColumns = onUndo ? columns.map(column => ({
    ...column,
    label: column.key === "firstMarkedAt" ? "First active mark" : column.key === "at" ? "Last active mark" : column.key === "markingCount" ? "Active marks" : column.label
  })) : columns;
  const term = search.trim().toLowerCase();
  const filtered = records.filter(record => !term || [record.caseNumber, record.siteId, record.reason, record.reviewer].some(value => String(value || "").toLowerCase().includes(term)));
  return <div className="overflow-x-auto">
    <Table>
      <TableHeader><TableRow>
        <SortableRecordHeaders columns={displayColumns} sort={sort} onSort={setSort} />
        {onUndo && <th scope="col" className="px-4 text-left">Actions</th>}
      </TableRow></TableHeader>
      <TableBody>
        {sortRecords(filtered, columns, sort).map(record => <TableRow key={record.caseNumber}>
          <TableCell><CaseNumberLink caseNumber={record.caseNumber} /></TableCell>
          <TableCell><SiteIdLink siteId={record.siteId} fallback="None" /></TableCell>
          <TableCell>{new Date(record.firstMarkedAt || record.at).toLocaleString()}</TableCell>
          <TableCell>{new Date(record.at).toLocaleString()}</TableCell>
          <TableCell>{record.reviewer}</TableCell>
          <TableCell className="max-w-sm whitespace-pre-wrap break-words">{record.reason || "No reason provided"}</TableCell>
          <TableCell>{record.markingCount ?? record.activeMarkIds?.length ?? 1}</TableCell>
          <TableCell>{record.currentState || "Improper"}</TableCell>
          {onUndo && <TableCell><Button size="sm" variant="outline" disabled={busy} onClick={() => onUndo(record)}>Undo mark</Button></TableCell>}
        </TableRow>)}
        {!filtered.length && <TableRow><TableCell colSpan={columns.length + (onUndo ? 1 : 0)} className="text-center">No improper requests found.</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>;
}
