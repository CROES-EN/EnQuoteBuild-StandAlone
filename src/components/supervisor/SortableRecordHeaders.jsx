import {TableHead} from "@/components/ui/table";
import {nextRecordSort} from "@/features/supervisorDashboard/recordSorting";

export default function SortableRecordHeaders({columns, sort, onSort}) {
  return columns.map(column => <TableHead key={column.key} aria-sort={sort?.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => onSort(nextRecordSort(sort, column.key))}>
      {column.label}
      {sort?.key === column.key && <span aria-hidden="true">{sort.direction === "asc" ? "\u25B2" : "\u25BC"}</span>}
    </button>
  </TableHead>);
}
