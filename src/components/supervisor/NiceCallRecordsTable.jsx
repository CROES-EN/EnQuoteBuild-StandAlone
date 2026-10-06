import {useState} from "react";
import {Table, TableBody, TableCell, TableHeader, TableRow} from "@/components/ui/table";
import SortableRecordHeaders from "./SortableRecordHeaders";
import {dateSortValue, numericSortValue, sortRecords} from "@/features/supervisorDashboard/recordSorting";

const columns = [
  {key: "id", label: "Contact ID", value: item => item.row["Contact ID"] || null},
  {key: "start", label: "Call start (PST)", value: item => dateSortValue(item.row["Contact Start Time (PST)"])},
  {key: "skill", label: "Skill", value: item => item.row.Skillname || null},
  {key: "agent", label: "Agent", value: item => item.row.Contactagentname || null},
  {key: "outcome", label: "Outcome", value: item => item.outcome},
  {key: "wait", label: "Wait (sec)", value: item => numericSortValue(item.row["Wait_Time(Sec)"])},
  {key: "talk", label: "Talk (sec)", value: item => numericSortValue(item.row["Talktime(Sec)"])}
];

export default function NiceCallRecordsTable({records, expected, undated, available}) {
  const [sort, setSort] = useState(null);
  const sorted = sortRecords(records, columns, sort);
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">NICE Call RAW DATA: {records.length} matching call records. Classification uses the explicit Abandons and Handled flags, not the agent name.</p>
    {!available && <p role="alert" className="text-sm text-amber-600">NICE Call RAW DATA has not been imported. Report totals remain unchanged.</p>}
    {available && expected !== null && expected !== records.length && <p role="alert" className="text-sm text-amber-600">Coverage mismatch: the EODB report counts {expected} calls; NICE raw data contains {records.length} matching records. Missing records are not fabricated.</p>}
    {undated > 0 && <p role="alert" className="text-sm text-amber-600">{undated} raw records have missing or unsupported call dates and cannot be assigned to this period.</p>}
    <Table>
      <TableHeader><TableRow><SortableRecordHeaders columns={columns} sort={sort} onSort={setSort} /></TableRow></TableHeader>
      <TableBody>{sorted.map(({id, row, outcome}) => <TableRow key={id}>
        <TableCell>{row["Contact ID"] || "Unknown"}</TableCell>
        <TableCell>{row["Contact Start Time (PST)"]}</TableCell>
        <TableCell>{row.Skillname || "Unknown"}</TableCell>
        <TableCell>{row.Contactagentname || "Unknown"}</TableCell>
        <TableCell>{outcome}</TableCell>
        <TableCell>{row["Wait_Time(Sec)"] ?? "Unknown"}</TableCell>
        <TableCell>{row["Talktime(Sec)"] ?? "Unknown"}</TableCell>
      </TableRow>)}
      {!records.length && <TableRow><TableCell colSpan={7}>No matching raw call records in this period.</TableCell></TableRow>}
      </TableBody>
    </Table>
  </div>;
}
