import {useEffect, useMemo, useState} from "react";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {ArrowUpDown, ChevronRight, Search, Settings2, SlidersHorizontal} from "lucide-react";
import {
    getHiddenColumns,
    resetColumnVisibility,
    setColumnVisibility
} from "@/features/supervisorDashboard/tableColumnPreferences";
import {
    getSummaryFields,
    resetSummaryFields,
    setSummaryFields
} from "@/features/supervisorDashboard/summaryFieldPreferences";

const NONE_VALUE = "__none__";
const SUMMARY_SLOT_COUNT = 4;
const PAGE_SIZE = 100;

// Column-name keywords used to guess a reasonable default summary field when no explicit
// defaultSummaryFields was provided for a report type and the user hasn't customized it yet -
// a last-resort fallback only, since ReportDataTablesPanel.jsx normally supplies real defaults.
const IDENTIFIER_HINTS = ["case number", "case #", "quote number", "id"];
const HOMEOWNER_HINTS = ["contact name", "homeowner", "customer name"];
const OWNER_HINTS = ["case owner", "owner", "assigned to"];
const STATUS_HINTS = ["o&m status", "status", "severity"];

function guessColumn(columns, hints, exclude) {
  for (const hint of hints) {
    const match = columns.find((col) => col.toLowerCase().includes(hint) && !exclude.includes(col));
    if (match) return match;
  }
  return null;
}

function guessSummaryFields(columns) {
  const used = [];
  const identifier = guessColumn(columns, IDENTIFIER_HINTS, used); if (identifier) used.push(identifier);
  const homeowner = guessColumn(columns, HOMEOWNER_HINTS, used); if (homeowner) used.push(homeowner);
  const owner = guessColumn(columns, OWNER_HINTS, used); if (owner) used.push(owner);
  const status = guessColumn(columns, STATUS_HINTS, used); if (status) used.push(status);
  return [
    identifier && { column: identifier, label: identifier },
    homeowner && { column: homeowner, label: "Homeowner" },
    owner && { column: owner, label: owner },
    status && { column: status, label: status }
  ].filter(Boolean);
}

/**
 * Popup showing every column of ONE row as labeled, stacked fields - the full-detail view
 * opened by clicking "View Details" on a compact row. Long values wrap naturally here instead
 * of being truncated, since this view has plenty of vertical room and only shows one record at
 * a time. Widened to max-w-2xl (from an earlier max-w-lg) for more comfortable reading of long
 * free-text fields like Case Comments.
 */
function RowDetailsDialog({ open, onOpenChange, columns, row, titleValue }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleValue || "Record Details"}</DialogTitle>
        </DialogHeader>
        <dl className="divide-y divide-slate-100">
          {columns.map((col) => (
            <div key={col} className="grid grid-cols-3 gap-4 py-2.5 text-sm">
              <dt className="col-span-1 font-medium text-muted-foreground">{col}</dt>
              <dd className="col-span-2 whitespace-pre-wrap break-words text-foreground">
                {row?.[col] || "None"}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline "Configure Fields" panel - lets the user choose which up-to-4 columns appear on the
 * compact row summary, and what label each one shows (e.g. displaying the "Contact Name" column
 * labeled as "Homeowner"). Saved per report type via summaryFieldPreferences.js.
 */
function SummaryFieldConfigurator({ columns, fields, onSave, onReset }) {
  const [draft, setDraft] = useState(() => {
    const slots = [...fields];
    while (slots.length < SUMMARY_SLOT_COUNT) slots.push({ column: "", label: "" });
    return slots.slice(0, SUMMARY_SLOT_COUNT);
  });

  function updateSlot(index, patch) {
    setDraft((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  function handleSave() {
    const cleaned = draft
      .filter((slot) => slot.column)
      .map((slot) => ({ column: slot.column, label: slot.label?.trim() || slot.column }));
    onSave(cleaned);
  }

  return (
    <div className="rounded-lg border border-border bg-secondary p-3">
      <p className="mb-3 text-xs text-muted-foreground">
        Choose up to {SUMMARY_SLOT_COUNT} columns to show on each compact row, and an optional
        display label for each (e.g. show the "Contact Name" column labeled as "Homeowner"). The
        first slot is also used as the popup title when viewing full details.
      </p>
      <div className="space-y-2">
        {draft.map((slot, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">Slot {index + 1}</span>
            <Select
              value={slot.column || NONE_VALUE}
              onValueChange={(v) => updateSlot(index, { column: v === NONE_VALUE ? "" : v, label: v === NONE_VALUE ? "" : (slot.label || v) })}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>None</SelectItem>
                {columns.map((col) => (
                  <SelectItem key={col} value={col}>{col}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Display label"
              value={slot.label}
              disabled={!slot.column}
              onChange={(e) => updateSlot(index, { label: e.target.value })}
              className="w-48"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleSave}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onReset}>Reset to Default</Button>
      </div>
    </div>
  );
}

/**
 * Browsable list for one imported report table (Escalations, Audits, Care-Cases, etc.) - shows
 * every row as a compact, LABELED summary (e.g. "Case Number: 20256618   Homeowner: James and
 * Carol Wiemar   Case Owner: Denice Ankenman   O&M Status: Quote Requested"), so nothing runs
 * off-screen, with a "View Details" action per row that opens every column as labeled, wrapped
 * fields in a wider popup. Which columns appear in the summary - and what label each shows - is
 * user-customizable via "Configure Fields" and persisted per report type.
 *
 * Also accepts onReload/isReloading so the parent (ReportDataTablesPanel) can offer an explicit
 * manual refresh, since imported data lives in a separate store this component doesn't own -
 * this component only displays whatever `table` it's given.
 */
export default function ReportDataTable({ reportType, table, defaultSummaryFields, defaultHiddenColumns, onReload, isReloading }) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showFieldConfig, setShowFieldConfig] = useState(false);
  const [detailsRow, setDetailsRow] = useState(null);
  const [, forceRerender] = useState(0);
  // Only PAGE_SIZE rows are ever mounted into the DOM at once (see paginatedRows below) -
  // search/sort still run over the FULL dataset, only rendering is limited. Without this,
  // a 10,000+ row report (e.g. Care Subscriptions) rendered every matching row into the DOM
  // simultaneously, which is what made the browser's native scrollbar thumb look tiny and
  // made the whole panel feel sluggish.
  const [page, setPage] = useState(0);

  // `defaultHiddenColumns` (optional) - columns hidden until the user explicitly shows them,
  // e.g. Care Subscriptions' many rarely-needed columns. Report types that don't pass this
  // (Escalations, SFDC-Quotes, etc.) keep the original "everything visible by default" behavior.
  const hiddenColumns = useMemo(
    () => getHiddenColumns(reportType, defaultHiddenColumns),
    [reportType, defaultHiddenColumns, showColumnPicker]
  );

  const visibleColumns = useMemo(
    () => (table?.columns ?? []).filter((col) => !hiddenColumns.has(col)),
    [table, hiddenColumns]
  );

  const summaryFields = useMemo(
    () => getSummaryFields(reportType, defaultSummaryFields),
    [reportType, defaultSummaryFields, showFieldConfig]
  );

  const resolvedSummaryFields = useMemo(() => {
    if (!table?.columns) return [];
    const valid = (summaryFields || []).filter((f) => table.columns.includes(f.column));
    if (valid.length > 0) return valid;
    return guessSummaryFields(table.columns);
  }, [table, summaryFields]);

  const filteredRows = useMemo(() => {
    if (!table?.rows) return [];
    const term = search.trim().toLowerCase();
    let rows = table.rows;
    if (term) {
      rows = rows.filter((row) =>
        visibleColumns.some((col) => String(row[col] ?? "").toLowerCase().includes(term))
      );
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        const aVal = String(a[sortColumn] ?? "");
        const bVal = String(b[sortColumn] ?? "");
        const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
        return sortDirection === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [table, visibleColumns, search, sortColumn, sortDirection]);

  // Whenever the underlying filtered/sorted result set changes (new search term, new sort,
  // a fresh import, etc.), snap back to page 1 - staying on e.g. page 40 after a search
  // narrows the results down to 3 rows would silently show "no rows" instead of the matches.
  useEffect(() => {
    setPage(0);
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  const paginatedRows = useMemo(
    () => filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredRows, page]
  );

  function handleToggleColumn(column, visible) {
    setColumnVisibility(reportType, column, visible);
    forceRerender((n) => n + 1);
  }

  function handleResetColumns() {
    resetColumnVisibility(reportType);
    forceRerender((n) => n + 1);
  }

  function handleSaveSummaryFields(fields) {
    setSummaryFields(reportType, fields);
    setShowFieldConfig(false);
    forceRerender((n) => n + 1);
  }

  function handleResetSummaryFields() {
    resetSummaryFields(reportType);
    setShowFieldConfig(false);
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
            <Button variant="ghost" size="sm" onClick={onReload} disabled={isReloading}>
              {isReloading ? "Reloading..." : "Reload"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setShowFieldConfig((v) => !v); setShowColumnPicker(false); }}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Configure Fields
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowColumnPicker((v) => !v); setShowFieldConfig(false); }}>
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Columns
          </Button>
        </div>
      </div>

      {showFieldConfig && (
        <SummaryFieldConfigurator
          columns={table.columns}
          fields={resolvedSummaryFields}
          onSave={handleSaveSummaryFields}
          onReset={handleResetSummaryFields}
        />
      )}

      {showColumnPicker && (
        <div className="rounded-lg border border-border bg-secondary p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Uncheck a column to exclude it from search and sorting - the full row (every
              column) is always shown in "View Details" regardless of this setting.
            </p>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={handleResetColumns}>
              Show all
            </Button>
          </div>
          <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-auto sm:grid-cols-3 md:grid-cols-4">
            {table.columns.map((col) => (
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

      {resolvedSummaryFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-1 text-xs text-muted-foreground">
          <span>Sort:</span>
          {resolvedSummaryFields.map((field) => (
            <button
              key={field.column}
              type="button"
              onClick={() => {
                if (sortColumn === field.column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                else { setSortColumn(field.column); setSortDirection("asc"); }
              }}
              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-muted ${sortColumn === field.column ? "font-medium text-primary" : ""}`}
            >
              {field.label} <ArrowUpDown className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[32rem] space-y-2 overflow-auto rounded-lg border border-border bg-card p-2">
        {paginatedRows.map((row, i) => (
          <button
            key={page * PAGE_SIZE + i}
            type="button"
            onClick={() => setDetailsRow(row)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                {resolvedSummaryFields.length > 0 ? (
                  resolvedSummaryFields.map((field, idx) => (
                    <span key={field.column} className="min-w-0 max-w-full truncate text-sm">
                      <span className="text-muted-foreground">{field.label}:</span>{" "}
                      <span className={idx === 0 ? "font-semibold text-foreground" : "text-foreground"}>
                        {row[field.column] || "None"}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="truncate text-sm text-muted-foreground">Row {page * PAGE_SIZE + i + 1}</span>
                )}
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
              View Details <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
        {filteredRows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {search ? "No rows match your search." : "No rows in this import."}
          </div>
        )}
      </div>

      {filteredRows.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filteredRows.length)} of{" "}
            {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span>Page {page + 1} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <RowDetailsDialog
        open={Boolean(detailsRow)}
        onOpenChange={(open) => !open && setDetailsRow(null)}
        columns={table.columns}
        row={detailsRow}
        titleValue={resolvedSummaryFields[0] ? detailsRow?.[resolvedSummaryFields[0].column] : null}
      />
    </div>
  );
}

