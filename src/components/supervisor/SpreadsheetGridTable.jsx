import {useEffect, useMemo, useRef, useState} from "react";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {ArrowDown, ArrowUp, ArrowUpDown, Search, Settings2} from "lucide-react";
import {
    getHiddenColumns,
    resetColumnVisibility,
    setColumnVisibility
} from "@/features/supervisorDashboard/tableColumnPreferences";
import {useVirtualizer} from "@tanstack/react-virtual";

/**
 * A true spreadsheet-style grid for browsing one imported report table AS-IS - every column
 * shown as its own header, every row as its own row, with a sticky header and native
 * horizontal + vertical scrollbars (no virtualization - deliberately kept simple, since this
 * app has no virtualization library installed and a plain scrollable <table> comfortably
 * handles a few thousand rows in modern browsers). Built specifically for NICE Call - RAW
 * DATA (2,709 real rows x 23 real columns confirmed this session) - a report too wide and
 * too detailed for the existing compact-row ReportDataTable (which only shows up to 4
 * configurable summary fields per row) to be useful for deep, Excel-like review.
 *
 * Click any column header to sort by it (single column at a time, toggling asc/desc on
 * repeated clicks) - numeric-looking values sort numerically, everything else sorts as text.
 * The existing free-text search box filters across every column. "Columns" lets a user turn
 * individual columns on/off - reuses the EXACT SAME tableColumnPreferences.js mechanism
 * already proven for the compact-row view (and Care Subscriptions' default-hidden columns),
 * so preferences persist consistently across this app rather than inventing a second,
 * parallel visibility system.
 *
 * Deliberately a SEPARATE component from ReportDataTable.jsx rather than a mode-switch inside
 * it - the two have fundamentally different layouts (all-columns-as-headers vs. a 4-slot
 * compact summary + "View Details" popup) and forcing one component to do both would make
 * each harder to reason about than just having two focused components.
 *
 * @param {string} [reportType] - used as the key for column-visibility persistence (defaults
 *   to "incorta_input" if not provided, since NICE Raw Data is this component's only caller
 *   today, but accepting it as a prop keeps this component reusable for a future report).
 * @param {string[]} [defaultHiddenColumns] - same optional mechanism as ReportDataTable.jsx,
 *   for a future report type that might want most columns hidden by default.
 */
export default function SpreadsheetGridTable({ reportType = "incorta_input", table, defaultHiddenColumns, onReload, isReloading }) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [, forceRerender] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const scrollContainerRef = useRef(null);
  // Debounces the search box (200ms) so filteredSortedRows below doesn't recompute a full
  // filter+sort pass on every single keystroke - matters increasingly as imported report
  // tables grow (NICE Raw Data alone is 2,700+ rows today).
  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timeoutId);
  }, [search]);

  const allColumns = table?.columns ?? [];

  const hiddenColumns = useMemo(
    () => getHiddenColumns(reportType, defaultHiddenColumns),
    [reportType, defaultHiddenColumns, showColumnPicker]
  );

  const visibleColumns = useMemo(
    () => allColumns.filter((col) => !hiddenColumns.has(col)),
    [allColumns, hiddenColumns]
  );

  const filteredSortedRows = useMemo(() => {
    if (!table?.rows) return [];
    const term = debouncedSearch.trim().toLowerCase();
    let rows = table.rows;
    if (term) {
      rows = rows.filter((row) =>
        visibleColumns.some((col) => String(row[col] ?? "").toLowerCase().includes(term))
      );
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        const aNum = Number.parseFloat(aVal);
        const bNum = Number.parseFloat(bVal);
        const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);
        const cmp = bothNumeric
          ? aNum - bNum
          : String(aVal ?? "").localeCompare(String(bVal ?? ""), undefined, { numeric: true });
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [table, visibleColumns, debouncedSearch, sortColumn, sortDirection]);

    // Row virtualization - only rows actually scrolled into view are rendered as real DOM
  // nodes, instead of all 2,700+ at once. Uses the "padding spacer <tr>" technique (see the
  // <tbody> below) since this is a genuine HTML <table> - absolute-positioned virtual rows
  // don't play well with native table layout the way they do in a div-based grid.
  const rowVirtualizer = useVirtualizer({
    count: filteredSortedRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 12
  });
  function handleHeaderClick(column) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function handleToggleColumn(column, visible) {
    setColumnVisibility(reportType, column, visible);
    forceRerender((n) => n + 1);
  }

  function handleResetColumns() {
    resetColumnVisibility(reportType);
    forceRerender((n) => n + 1);
  }

  if (!table) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-muted-foreground">
        No data imported yet for this report. Use "Import This Report" to load it.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            From {table.sourceFileName} - imported {new Date(table.importedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search rows..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-7"
            />
          </div>
          {onReload && (
            <button
              type="button"
              onClick={onReload}
              disabled={isReloading}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              {isReloading ? "Reloading..." : "Reload"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowColumnPicker((v) => !v)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Columns
          </button>
        </div>
      </div>

      {showColumnPicker && (
        <div className="rounded-lg border border-border bg-secondary p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Uncheck a column to hide it from the grid, search, and sorting.
            </p>
            <button
              type="button"
              onClick={handleResetColumns}
              className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Show all
            </button>
          </div>
          <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-auto sm:grid-cols-3 md:grid-cols-4">
            {allColumns.map((col) => (
              <label key={col} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-foreground">
                <Checkbox
                  checked={!hiddenColumns.has(col)}
                  onCheckedChange={(checked) => handleToggleColumn(col, checked === true)}
                />
                {col}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Native horizontal + vertical scroll - the header row uses `sticky top-0` so column
          names stay visible while scrolling down through 2,000+ rows, without any
          virtualization library. */}
      <div ref={scrollContainerRef} className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-secondary">
            <tr>
              {visibleColumns.map((col) => {
                const isSorted = sortColumn === col;
                return (
                  <th
                    key={col}
                    onClick={() => handleHeaderClick(col)}
                    className="cursor-pointer whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-foreground hover:bg-muted"
                  >
                    <span className="flex items-center gap-1">
                      {col}
                      {isSorted ? (
                        sortDirection === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-primary" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const virtualItems = rowVirtualizer.getVirtualItems();
              const totalSize = rowVirtualizer.getTotalSize();
              const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
              const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;
              return (
                <>
                  {paddingTop > 0 && (
                    <tr><td colSpan={visibleColumns.length || 1} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} /></tr>
                  )}
                  {virtualItems.map((virtualRow) => {
                    const row = filteredSortedRows[virtualRow.index];
                    return (
                      <tr key={virtualRow.index} className="odd:bg-card even:bg-secondary/40 hover:bg-indigo-50">
                        {visibleColumns.map((col) => (
                          <td key={col} className="whitespace-nowrap border-b border-border/50 px-3 py-1.5 text-foreground">
                            {row[col] === "" || row[col] === null || row[col] === undefined ? (
                              <span className="text-muted-foreground">--</span>
                            ) : (
                              String(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr><td colSpan={visibleColumns.length || 1} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} /></tr>
                  )}
                </>
              );
            })()}
            {filteredSortedRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length || 1} className="py-8 text-center text-sm text-muted-foreground">
                  {search ? "No rows match your search." : "No rows in this import."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Displaying {filteredSortedRows.length} row{filteredSortedRows.length === 1 ? "" : "s"}
        {search ? ` (filtered from ${table.rows.length})` : ""}
      </p>
    </div>
  );
}