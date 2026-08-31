import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu";
import RMAStatusBadge from "@/components/rma/RMAStatusBadge";
import { getDaysOpen, getDaysInCurrentStatus } from "@/components/rma/rmaUtils";
import {
  ChevronUp, ChevronDown, ExternalLink, Pencil, Columns3,
  ChevronLeft, ChevronRight, Inbox
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { key: "case_owner", label: "Case Owner", visible: true },
  { key: "site_id", label: "Site ID", visible: true },
  { key: "case_id", label: "Case ID", visible: true },
  { key: "panel_manufacturer", label: "Manufacturer", visible: true },
  { key: "current_status", label: "Status", visible: true },
  { key: "days_in_current_status", label: "Days in Status", visible: true },
  { key: "days_open", label: "Days Open", visible: true },
  { key: "last_updated", label: "Last Updated", visible: true },
  { key: "rma_url", label: "RMA URL", visible: false },
];

const PAGE_SIZE = 10;

export default function RMAList({ rmas, onEdit, isLoading }) {
  const [sortKey, setSortKey] = useState("last_updated");
  const [sortDir, setSortDir] = useState("desc");
  const [columns, setColumns] = useState(COLUMNS);
  const [page, setPage] = useState(0);

  useEffect(() => { setPage(0); }, [rmas]);

  const getCellValue = (rma, key) => {
    switch (key) {
      case "days_open": return getDaysOpen(rma);
      case "days_in_current_status": return getDaysInCurrentStatus(rma);
      case "last_updated": return rma.updated_date || rma.created_date || "";
      default: return rma[key] || "";
    }
  };

  const sortedRmas = useMemo(() => {
    return [...rmas].sort((a, b) => {
      const aVal = getCellValue(a, sortKey);
      const bVal = getCellValue(b, sortKey);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortDir === "asc" ? -1 : 1;
      if (aStr > bStr) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rmas, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRmas.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginatedRmas = sortedRmas.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleColumn = (key) => {
    setColumns(prev => prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };

  const visibleColumns = columns.filter(c => c.visible);

  const renderCell = (rma, key) => {
    switch (key) {
      case "current_status":
        return <RMAStatusBadge status={rma.current_status} size="sm" />;
      case "days_open":
        return <span className={cn("font-medium", getDaysOpen(rma) > 30 && "text-rose-600")}>{getDaysOpen(rma)}</span>;
      case "days_in_current_status":
        return <span className={cn("font-medium", getDaysInCurrentStatus(rma) > 14 && "text-amber-600")}>{getDaysInCurrentStatus(rma)}</span>;
      case "last_updated":
        return rma.updated_date ? format(new Date(rma.updated_date), "MMM d, yyyy") : "—";
      case "rma_url":
        return rma.rma_url ? (
          <a href={rma.rma_url} target="_blank" rel="noopener noreferrer"
            className="text-blue-600 hover:underline inline-flex items-center gap-1"
            onClick={e => e.stopPropagation()}>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : "—";
      default:
        return rma[key] || "—";
    }
  };

  if (isLoading) {
    return (
      <Card className="p-12 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </Card>
    );
  }

  if (rmas.length === 0) {
    return (
      <Card className="p-12 flex flex-col items-center justify-center text-center">
        <Inbox className="w-12 h-12 text-slate-300 mb-3" />
        <p className="text-slate-500 font-medium">No RMAs found</p>
        <p className="text-sm text-slate-400 mt-1">Try adjusting your filters or add a new RMA.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <p className="text-sm text-slate-600">
          {sortedRmas.length} RMA{sortedRmas.length !== 1 ? "s" : ""}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="w-4 h-4 mr-2" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {COLUMNS.map(col => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={columns.find(c => c.key === col.key)?.visible}
                onCheckedChange={() => toggleColumn(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors whitespace-nowrap"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      sortDir === "asc"
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedRmas.map(rma => (
              <tr
                key={rma.id}
                className="hover:bg-slate-50 cursor-pointer transition-colors"
                onClick={() => onEdit(rma)}
              >
                {visibleColumns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">
                    {renderCell(rma, col.key)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => { e.stopPropagation(); onEdit(rma); }}
                  >
                    <Pencil className="w-4 h-4 text-slate-500" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between p-4 border-t border-slate-100">
          <p className="text-sm text-slate-600">
            Page {currentPage + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}