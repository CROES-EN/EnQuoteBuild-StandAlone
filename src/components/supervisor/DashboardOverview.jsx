import {cloneElement, useEffect, useMemo, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {toast} from "sonner";
import {useQuery} from "@tanstack/react-query";
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    Clock,
    FileText,
    HeartHandshake,
    Layers,
    Mail,
    Minus,
    Phone,
    PhoneOff,
    TrendingDown,
    TrendingUp,
    TriangleAlert,
    Users
} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Checkbox} from "@/components/ui/checkbox";
import {getAllQuoteActivities, getQuotes} from "@/api/dataClient";
import {buildQuoteLifecycleReport} from "@/features/quoteDashboard/quoteLifecycle";
import QuotePeriodActivityTile from "@/components/supervisor/QuotePeriodActivityTile";
import ImproperQuoteRequestsTile from "@/components/supervisor/ImproperQuoteRequestsTile";
import QuoteContributingRecordsDialog from "@/components/supervisor/QuoteContributingRecordsDialog";
import NiceCallRecordsTable from "@/components/supervisor/NiceCallRecordsTable";
import SortableRecordHeaders from "@/components/supervisor/SortableRecordHeaders";
import {sortRecords} from "@/features/supervisorDashboard/recordSorting";
import {dailyCountValue, displayCount, displayModeRecords, quoteDisplayMetric} from "@/features/supervisorDashboard/kpiDisplayMode";
import {niceCallContributingRecords, quoteContributingRecords} from "@/features/supervisorDashboard/contributingRecords";
import {formatDateLabel, formatNumber, formatRate, formatSecondsAsClock} from "@/features/supervisorDashboard/format";
import {
    filterRecordsInRange,
    getPreviousPeriodRange,
    resolveDateRange,
    resolveDefaultPreset
} from "@/features/supervisorDashboard/dateRanges";
import {
    aggregateMetric,
    AGGREGATION_MODE_OPTIONS,
    AGGREGATION_MODES,
    comparePeriods,
    computeNetBacklogMovement,
    computeRateFromTotals,
    resolveClosingBacklog,
    resolveOpeningBacklog
} from "@/features/supervisorDashboard/periodAggregation";
import {
    computeQuoteOpsMetrics,
    DEFAULT_COMPLETED_STATUSES,
    isReportableQuote
} from "@/features/supervisorDashboard/quoteOpsMetrics";
import {computeQuoteAlert} from "@/utils/quoteSLA";
import {listReportTables} from "@/features/supervisorDashboard/importedTableStore";
import {
    computeStaffingTeamTotalsV2,
    getRecordsFromStoredRowsV2
} from "@/features/supervisorDashboard/parseOMStaffingReport";
import {
    computeEmailBacklogTotals,
    getEmailBacklogRecordsFromStoredRows,
    parseEmailBacklogDailyRows
} from "@/features/supervisorDashboard/parseEmailBacklogReport";
import {
    computeEodbWidgetTotal,
    getEodbWidgetRecordsFromStoredRows
} from "@/features/supervisorDashboard/parseEodbWidget";
import DashboardDateRange from "@/components/supervisor/DashboardDateRange";
import {useReportingPeriodPreference} from "@/features/supervisorDashboard/useReportingPeriodPreference";
import {readSharedDashboardPeriod, sharedDashboardTilePath, SHARED_PERIOD_QUERY, SHARED_TILE_QUERY} from "@/features/supervisorDashboard/sharedDashboardPeriod";
import QuoteExceptionsPanel from "@/components/supervisor/QuoteExceptionsPanel";
import DrillDownDrawer from "@/components/supervisor/DrillDownDrawer";
import HourlyWaitTimeChart from "@/components/supervisor/HourlyWaitTimeChart";
import TileGrid from "@/components/supervisor/TileGrid";
import {
    applyPartialReorder,
    getHiddenTileIds,
    getTileOrder,
    orderTiles,
    setTileOrder,
    setTileVisibility
} from "@/features/supervisorDashboard/tilePreferences";

import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";

// Display text used whenever a value is blank, missing, or not applicable - a plain word instead
// of a dash/em-dash character, both for readability and to avoid any special-character encoding
// issues when this file is saved, copied, or read across different tools.
const BLANK_DISPLAY = "None";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function seriesFor(records, key) {
  return (records || []).map(record => ({ date: record.date, value: record?.[key] }));
}

function effectiveMode(additive, mode) {
  return additive ? mode : (mode === AGGREGATION_MODES.PERIOD_TOTAL ? AGGREGATION_MODES.DAILY_AVERAGE : mode);
}

const MODE_LABELS = {
  [AGGREGATION_MODES.PERIOD_TOTAL]: "Period Total",
  [AGGREGATION_MODES.DAILY_AVERAGE]: "Daily Average",
  [AGGREGATION_MODES.LATEST_DAY]: "Latest Day"
};

// The exact column header used in the imported SFDC-Quotes workbook for O&M Status - must match
// verbatim (including the ampersand and spacing) since spreadsheet headers are read as-is.
const SFDC_OM_STATUS_COLUMN = "O&M Status";
const QUOTE_REQUESTED_VALUE = "quote requested";

// Priority 1-7 per the O&M reporting spec's KPI ROW list, adapted to what this data model can
// actually compute today - "Opening Quote Backlog" (priority 8) is folded into the combined
// Quote Backlog card below instead of a standalone tile, so the primary row still respects the
// spec's "up to eight cards" cap while showing Opening/Closing/Net together.
const PRIMARY_KPI_DEFINITIONS = [


  { key: "sf_quotes_received", label: "Quotes Received", icon: FileText, iconClass: "bg-violet-50 text-violet-600", kind: "field", fieldKey: "sf_quotes_received", additive: true, direction: "neutral", sourceLabel: "Salesforce import" },
  { key: "quotes_drafted_live", label: "Quotes Drafted", icon: FileText, iconClass: "bg-amber-50 text-amber-600", kind: "quoteOps", valueKey: "quotesDrafted", additive: true, direction: "higherIsBetter", sourceLabel: "Live from EnQuote" },
  { key: "quotes_completed_live", label: "Quotes Completed", icon: CheckCircle2, iconClass: "bg-teal-50 text-teal-600", kind: "quoteOps", valueKey: "quotesCompleted", additive: true, direction: "higherIsBetter", sourceLabel: "Live from EnQuote" }
];

// Priorities 11-16 - shown in a smaller "More Metrics" row so every spec-listed KPI stays
// available without crowding the primary at-a-glance row.
const SECONDARY_KPI_DEFINITIONS = [
  { key: "new_cases_received", label: "New O&M Cases", icon: Layers, iconClass: "bg-sky-50 text-sky-600", kind: "field", fieldKey: "new_cases_received", additive: true, direction: "neutral", sourceLabel: "Case Backlog" },
  { key: "cases_completed", label: "Completed O&M Cases", icon: CheckCircle2, iconClass: "bg-teal-50 text-teal-600", kind: "field", fieldKey: "cases_completed", additive: true, direction: "higherIsBetter", sourceLabel: "Case Backlog" },
  { key: "staffing_present", label: "Available Staff", icon: Users, iconClass: "bg-emerald-50 text-emerald-600", kind: "field", fieldKey: "staffing_present", additive: false, direction: "neutral", sourceLabel: "Staffing" },
  { key: "open_critical_escalations", label: "Open Critical Escalations", icon: TriangleAlert, iconClass: "bg-orange-50 text-orange-600", kind: "field", fieldKey: "open_critical_escalations", additive: false, direction: "lowerIsBetter", sourceLabel: "Escalations" },
  { key: "overdue_follow_ups", label: "Overdue Follow-Ups", icon: AlertCircle, iconClass: "bg-orange-50 text-orange-600", kind: "field", fieldKey: "overdue_follow_ups", additive: false, direction: "lowerIsBetter", sourceLabel: "Escalations" }
];

function computeFieldKpi(def, rangedRecords, previousRangedRecords, mode) {
  const mode_ = effectiveMode(def.additive, mode);
  const current = aggregateMetric(seriesFor(rangedRecords, def.fieldKey), mode_, { additive: def.additive });
  const previous = aggregateMetric(seriesFor(previousRangedRecords, def.fieldKey), mode_, { additive: def.additive });
  return { current, previous, mode: mode_ };
}

function computeQuoteOpsKpi(def, quoteOpsSeries, previousQuoteOpsSeries, mode) {
  const current = aggregateMetric(quoteOpsSeries.map(q => ({ date: q.date, value: q[def.valueKey] })), mode, { additive: true });
  const previous = aggregateMetric(previousQuoteOpsSeries.map(q => ({ date: q.date, value: q[def.valueKey] })), mode, { additive: true });
  return { current, previous, mode };
}

function computeRateKpi(def, rangedRecords, previousRangedRecords, mode) {
  if (mode === AGGREGATION_MODES.LATEST_DAY) {
    const findLatest = (records) => [...records]
      .sort((a, b) => b.date.localeCompare(a.date))
      .find(r => isFiniteNumber(r[def.numeratorKey]) && isFiniteNumber(r[def.denominatorKey]) && r[def.denominatorKey] !== 0);
    const latest = findLatest(rangedRecords);
    const prevLatest = findLatest(previousRangedRecords);
    return {
      current: latest ? { value: latest[def.numeratorKey] / latest[def.denominatorKey], date: latest.date, contributingCount: 1 } : null,
      previous: prevLatest ? { value: prevLatest[def.numeratorKey] / prevLatest[def.denominatorKey], date: prevLatest.date, contributingCount: 1 } : null,
      mode
    };
  }
  const rate = computeRateFromTotals(seriesFor(rangedRecords, def.numeratorKey), seriesFor(rangedRecords, def.denominatorKey));
  const prevRate = computeRateFromTotals(seriesFor(previousRangedRecords, def.numeratorKey), seriesFor(previousRangedRecords, def.denominatorKey));
  return {
    current: rate ? { value: rate.rate, contributingCount: null } : null,
    previous: prevRate ? { value: prevRate.rate, contributingCount: null } : null,
    mode: AGGREGATION_MODES.PERIOD_TOTAL
  };
}

function computeKpiResult(def, rangedRecords, previousRangedRecords, quoteOpsSeries, previousQuoteOpsSeries, mode) {
  if (def.kind === "field" || def.kind === "duration") return computeFieldKpi(def, rangedRecords, previousRangedRecords, mode);
  if (def.kind === "quoteOps") return computeQuoteOpsKpi(def, quoteOpsSeries, previousQuoteOpsSeries, mode);
  if (def.kind === "rate") return computeRateKpi(def, rangedRecords, previousRangedRecords, mode);
  return { current: null, previous: null, mode };
}

function formatKpiValue(def, current) {
  if (!current) return BLANK_DISPLAY;
  if (def.kind === "duration") return formatSecondsAsClock(current.value);
  if (def.kind === "rate") return formatRate(current.value);
  return formatNumber(Math.round(current.value * 100) / 100);
}

function ComparisonNote({ comparison, direction }) {
  if (!comparison || !comparison.hasPrevious) {
    return <span className="text-xs text-muted-foreground">No prior period</span>;
  }
  if (comparison.previousWasZero) {
    return <span className="text-xs text-muted-foreground">Previous period value was zero</span>;
  }
  if (comparison.change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    );
  }
  const isGood = direction === "neutral" ? null : (direction === "higherIsBetter" ? comparison.change > 0 : comparison.change < 0);
  const colorClass = isGood === null ? "text-muted-foreground" : (isGood ? "text-emerald-600" : "text-rose-600");
  const Icon = comparison.change > 0 ? TrendingUp : TrendingDown;
  const sign = comparison.change > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      <Icon className="h-3 w-3" />
      {sign}{formatNumber(Math.round(comparison.change * 100) / 100)}
      {comparison.percent !== null ? ` (${sign}${comparison.percent}%)` : ""}
    </span>
  );
}

function KpiCard({ def, result, showComparison, onViewRecords }) {
  const { current, previous, mode } = result;
  const comparison = showComparison ? comparePeriods(current?.value ?? null, previous?.value ?? null) : null;
  const Icon = def.icon;
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${def.iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        {showComparison && <ComparisonNote comparison={comparison} direction={def.direction} />}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{def.label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{formatKpiValue(def, current)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">{MODE_LABELS[mode] || mode}</Badge>
        {mode === AGGREGATION_MODES.LATEST_DAY && current?.date && (
          <span className="text-[11px] text-muted-foreground">as of {formatDateLabel(current.date)}</span>
        )}
        {mode === AGGREGATION_MODES.DAILY_AVERAGE && current?.contributingCount && (
          <span className="text-[11px] text-muted-foreground">across {current.contributingCount} day{current.contributingCount === 1 ? "" : "s"}</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{def.sourceLabel}</p>
      {onViewRecords && (
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          View contributing records
        </button>
      )}
    </div>
  );
}

/**
 * A KPI-styled tile for values that come from a Report Data Tables import (importedTableStore.js)
 * rather than the date-ranged daily-metrics store - e.g. "Quotes Requested" counted live from the
 * SFDC-Quotes table. Deliberately visually distinct from KpiCard's "Period Total / Daily Average
 * / Latest Day" + trend-vs-previous-period language, since this number has no historical series
 * or date range of its own - it is simply "how many matching rows exist in the last import right
 * now". Uses a "Snapshot" badge in place of a trend arrow and "Live Count" in place of the
 * aggregation-mode badge so it can never be mistaken for a date-ranged, trend-aware metric.
 */
function LiveCountCard({ label, icon: Icon, iconClass, count, sourceLabel, onViewRecords }) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs text-muted-foreground">Snapshot</span>
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{formatNumber(count)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">Live Count</Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{sourceLabel}</p>
      {onViewRecords && (
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          View contributing records
        </button>
      )}
    </div>
  );
}

/**
 * Small dialog listing the SFDC-Quotes rows currently counted by the "Quotes Requested" tile -
 * a lightweight, self-contained alternative to DrillDownDrawer (which expects daily-metric
 * records shaped by date/fieldKey, not arbitrary imported spreadsheet rows with many columns).
 * Blank values display as "None" rather than a dash, matching the rest of the Report Data views.
 */
/**
 * Shared comparator for every drill-down dialog's sortable column headers. Null values
 * (missing data) always sort to the end, regardless of direction. Values are compared as
 * strings (localeCompare) or numbers depending on what each column's sortValue() extracts.
 */
function compareDialogValues(av, bv, sortDir) {
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = typeof av === "string" ? av.localeCompare(bv) : (av < bv ? -1 : av > bv ? 1 : 0);
  return sortDir === "asc" ? cmp : -cmp;
}

const QUOTES_REQUESTED_COLUMNS = [
  { key: "caseNumber", label: "Case Number", sortValue: (row) => row["Case Number"] || "" },
  { key: "caseOwner", label: "Case Owner", sortValue: (row) => row["Case Owner"] || "" },
  { key: "subject", label: "Subject", sortValue: (row) => row["Subject"] || "" },
  { key: "dateOpened", label: "Date/Time Opened", sortValue: (row) => row["Date/Time Opened"] || "" }
];

function QuotesRequestedDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const activeColumn = QUOTES_REQUESTED_COLUMNS.find((c) => c.key === sortKey);
  const sortedRows = activeColumn
    ? [...rows].sort((a, b) => compareDialogValues(activeColumn.sortValue(a), activeColumn.sortValue(b), sortDir))
    : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quotes Requested - SFDC-Quotes</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {rows.length} row{rows.length === 1 ? "" : "s"} currently marked "Quote Requested" in the last SFDC-Quotes import.
          Full case details are available on the Report Data tab. Select any column header to sort.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {QUOTES_REQUESTED_COLUMNS.map((column) => (
                <TableHead key={column.key}>
                  <button type="button" onClick={() => handleHeaderClick(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                    {column.label}
                    {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row, i) => (
              <TableRow key={i}>
                <TableCell><CaseNumberLink caseNumber={row["Case Number"]} caseId={row["Case ID"]} fallback={BLANK_DISPLAY} /></TableCell>
                <TableCell>{row["Case Owner"] || BLANK_DISPLAY}</TableCell>
                <TableCell className="max-w-xs truncate" title={String(row["Subject"] ?? "")}>{row["Subject"] || BLANK_DISPLAY}</TableCell>
                <TableCell>{row["Date/Time Opened"] || BLANK_DISPLAY}</TableCell>
              </TableRow>
            ))}
            {sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No matching rows.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lists every quote currently counted by the Alert-based "Quote Backlog" tile -
 * Site ID, current status, the specific Alert rule that fired, its level
 * (yellow/red), and how long it's been in that status. Computed live from
 * EnQuote's own quote records via quoteSLA.js's computeQuoteAlert - the exact
 * same logic already shown on individual quote cards (SLAAlertBadge) - so this
 * count can never disagree with what a user sees on any individual quote.
 */
/**
 * Toggle-on/off panel for the unified tile grid - lists every known tile,
 * grouped by its report category, with a checkbox to show/hide it. Dragging
 * any tile directly on the page (via TileGrid) handles reordering; this
 * dialog is only for visibility.
 */
function TileCustomizationDialog({ open, onOpenChange, tiles, onChanged }) {
  const hiddenIds = getHiddenTileIds();
  function handleToggle(id, visible) {
    setTileVisibility(id, visible);
    onChanged();
  }
  const grouped = tiles.reduce((acc, tile) => {
    if (!acc[tile.category]) acc[tile.category] = [];
    acc[tile.category].push(tile);
    return acc;
  }, {});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize Tiles</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          Toggle which tiles appear on Executive Overview. Drag any tile on the page to reorder it - your choices are saved on this computer.
        </p>
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, group]) => (
            <div key={category}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</p>
              <div className="space-y-1.5">
                {group.map((tile) => (
                  <label key={tile.id} className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={!hiddenIds.has(tile.id)} onCheckedChange={(checked) => handleToggle(tile.id, checked === true)} />
                    {tile.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
const QUOTE_BACKLOG_ALERT_COLUMNS = [
  { key: "siteId", label: "Site ID", sortValue: ({ quote }) => quote.site_id || "" },
  { key: "status", label: "Status", sortValue: ({ quote }) => quote.status || "" },
  { key: "alertName", label: "Alert", sortValue: ({ alert }) => alert.name || "" },
  { key: "level", label: "Level", sortValue: ({ alert }) => alert.level || "" },
  { key: "timeInStatus", label: "Time in Status", sortValue: ({ alert }) => alert.timeLabel || "" }
];

function QuoteBacklogAlertDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const activeColumn = QUOTE_BACKLOG_ALERT_COLUMNS.find((c) => c.key === sortKey);
  const sortedRows = activeColumn
    ? [...rows].sort((a, b) => compareDialogValues(activeColumn.sortValue(a), activeColumn.sortValue(b), sortDir))
    : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quote Backlog - Quotes with an Active Alert</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {rows.length} quote{rows.length === 1 ? "" : "s"} currently have an active Alert (yellow or red),
          per the same Alert logic shown on individual quote cards. Live from EnQuote - not an imported report. Select any column header to sort.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {QUOTE_BACKLOG_ALERT_COLUMNS.map((column) => (
                <TableHead key={column.key}>
                  <button type="button" onClick={() => handleHeaderClick(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                    {column.label}
                    {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(({ quote, alert }) => (
              <TableRow key={quote.id}>
                <TableCell><SiteIdLink siteId={quote.site_id} fallback={BLANK_DISPLAY} /></TableCell>
                <TableCell>{quote.status || BLANK_DISPLAY}</TableCell>
                <TableCell>{alert.name || BLANK_DISPLAY}</TableCell>
                <TableCell className={alert.level === "red" ? "text-rose-600 font-semibold" : "text-amber-600 font-semibold"}>
                  {alert.level ? alert.level.toUpperCase() : BLANK_DISPLAY}
                </TableCell>
                <TableCell>{alert.timeLabel || BLANK_DISPLAY}</TableCell>
              </TableRow>
            ))}
            {sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No quotes currently have an active Alert.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
/**
 * Lists every "Call Interaction" row counted by the Interactions tiles - Team, Contact ID, Call
 * Time, Status (read directly from Incorta's own Handled/Abandons columns), Wait Time, and Talk
 * Time. Computed live from Incorta-O&M-Input, filtered to the selected Reporting Period.
 */
// Column definitions for InteractionsDialog's sortable headers - "sortValue" extracts the
// comparable value from a raw row (handles the computed Status field, and Wait/Talk time
// parsed as numbers rather than their formatted "Xm Ys" display strings).
const INTERACTIONS_COLUMNS = [
  { key: "team", label: "Team", sortValue: (row) => row["Skillname"] || "" },
  { key: "contactId", label: "Contact ID", sortValue: (row) => row["Contact ID"] || "" },
  { key: "callTime", label: "Call Time", sortValue: (row) => row["Contact Start Time (PST)"] || "" },
  { key: "status", label: "Status", sortValue: (row) => (String(row["Handled"] ?? "").trim() === "1" ? "Handled" : "Abandoned") },
  { key: "waitTime", label: "Wait Time", sortValue: (row) => { const n = Number.parseFloat(row["Wait_Time(Sec)"]); return Number.isFinite(n) ? n : null; } },
  { key: "talkTime", label: "Talk Time", sortValue: (row) => { const isHandled = String(row["Handled"] ?? "").trim() === "1"; if (!isHandled) return null; const n = Number.parseFloat(row["Talktime(Sec)"]); return Number.isFinite(n) ? n : null; } }
];

function InteractionsDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function formatSecondsShort(value) {
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return BLANK_DISPLAY;
    const mins = Math.floor(num / 60);
    const secs = Math.round(num % 60);
    return `${mins}m ${secs}s`;
  }

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const activeColumn = INTERACTIONS_COLUMNS.find((c) => c.key === sortKey);
  const sortedRows = activeColumn
    ? [...rows].sort((a, b) => compareDialogValues(activeColumn.sortValue(a), activeColumn.sortValue(b), sortDir))
    : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Call Interactions - Incorta-O&M-Input</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {rows.length} interaction{rows.length === 1 ? "" : "s"} in the selected Reporting Period, live from Incorta-O&M-Input. Select any column header to sort.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {INTERACTIONS_COLUMNS.map((column) => (
                <TableHead key={column.key}>
                  <button type="button" onClick={() => handleHeaderClick(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                    {column.label}
                    {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row, idx) => {
              const isHandled = String(row["Handled"] ?? "").trim() === "1";
              const status = isHandled ? "Handled" : "Abandoned";
              return (
                <TableRow key={row["Contact ID"] || idx}>
                  <TableCell>{row["Skillname"] || BLANK_DISPLAY}</TableCell>
                  <TableCell>{row["Contact ID"] || BLANK_DISPLAY}</TableCell>
                  <TableCell>{row["Contact Start Time (PST)"] || BLANK_DISPLAY}</TableCell>
                  <TableCell className={isHandled ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>{status}</TableCell>
                  <TableCell>{formatSecondsShort(row["Wait_Time(Sec)"])}</TableCell>
                  <TableCell>{isHandled ? formatSecondsShort(row["Talktime(Sec)"]) : BLANK_DISPLAY}</TableCell>
                </TableRow>
              );
            })}
            {sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No interactions in the selected Reporting Period.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
function BacklogCard({ label, icon: Icon, iconClass, backlog, showComparison, direction, onViewRecords }) {
  const { opening, closing, net, prevNet } = backlog;
  const comparison = showComparison ? comparePeriods(net, prevNet) : null;
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        {showComparison && <ComparisonNote comparison={comparison} direction={direction} />}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xl font-bold text-foreground">{opening ? formatNumber(opening.value) : BLANK_DISPLAY}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-xl font-bold text-foreground">{closing ? formatNumber(closing.value) : BLANK_DISPLAY}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Net movement: {net !== null ? `${net > 0 ? "+" : ""}${formatNumber(net)}` : BLANK_DISPLAY}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">Point-in-Time</Badge>
        {opening && closing && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {formatDateLabel(opening.date)} <ArrowRight className="h-3 w-3" /> {formatDateLabel(closing.date)}
          </span>
        )}
      </div>
      {onViewRecords && (
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          View contributing records
        </button>
      )}
    </div>
  );
}

/**
 * Formats a large accumulated seconds total (e.g. a team-wide sum across many agents and
 * many days) as "11,626 Hours" / "33 Minutes" on two lines - unlike formatSecondsAsClock's
 * H:MM:SS format, which is built for single-call/single-day durations and becomes unreadable
 * once hours run into the thousands (e.g. "11626:33"). Minutes are derived from the rounded
 * total, so seconds are never separately displayed or lost silently - just rounded to the
 * nearest whole minute, which is more than precise enough at this scale.
 */
function formatSecondsAsHoursMinutes(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return "N/A";
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toLocaleString()} H\n${minutes} Min`;
}

/**
 * A simple stat tile for Boise O&M team totals (Executive Overview) - visually consistent
 * with LiveCountCard/KpiCard, but takes an already-formatted display string directly instead
 * of a raw count, since these values are a mix of durations, percentages, and plain counts.
 * Deliberately self-contained and independent of the KpiCard/computeKpiResult pipeline (which
 * is built specifically for daily-metrics records), since this tile has no per-period
 * comparison or aggregation-mode toggle - just a team-wide total for the active Reporting
 * Period. Supports an optional onViewRecords callback, matching the same "View contributing
 * records" button pattern already used by LiveCountCard/KpiCard/BacklogCard elsewhere.
 */
// Formats a report's stored importedAt/importMethod into a short, human-readable line (e.g.
// "Auto-imported Sep 11, 3:51 AM") - used by StaffingStatCard below to show, right under the
// tile's label, exactly when and how its underlying data was last refreshed. Added specifically
// so it's possible to visually confirm at a glance whether the new EODB/Email auto-import
// watcher actually ran, rather than needing to check enquote-data-v1.json by hand.
function formatImportTimestamp(importedAt, importMethod) {
  if (!importedAt) return null;
  const date = new Date(importedAt);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
  const methodLabel = importMethod === "auto" ? "Auto-imported" : "Manually imported";
  return `${methodLabel} ${formatted}`;
}

function StaffingStatCard({ label, icon: Icon, iconClass, value, sourceLabel, onViewRecords, importedAt, importMethod, mode, date }) {
  const importTimestampLabel = formatImportTimestamp(importedAt, importMethod);
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {importTimestampLabel && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground/80">{importTimestampLabel}</p>
      )}
      <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">{mode ? MODE_LABELS[mode] : "Snapshot"}</Badge>
        {date && <span className="text-[11px] text-muted-foreground">as of {formatDateLabel(date)}</span>}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{sourceLabel}</p>
      {onViewRecords && (
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          View contributing records
        </button>
      )}
    </div>
  );
}

/**
 * Shared drill-down dialog for every Boise O&M tile - lists every per-agent-day row
 * contributing to the tiles' team totals for the active Reporting Period. One shared dialog
 * reused by all Staffing tiles (same "one dialog, many tiles" pattern already used by
 * InteractionsDialog, which every Incorta-O&M-Input tile opens identically).
 */
// Column definitions for StaffingRecordsDialog's sortable headers - "key" matches the field
// name on each record; "type" determines comparison behavior (string vs. numeric/duration -
// duration/percent/count fields all compare fine as plain numbers or null).
const STAFFING_RECORDS_COLUMNS = [
  { key: "date", label: "Date", type: "string" },
  { key: "agentName", label: "Agent", type: "string" },
  { key: "loginTimeSec", label: "Login Time", type: "number" },
  { key: "acdContacts", label: "ACD Contacts", type: "number" },
  { key: "talkTimeSec", label: "Talk Time", type: "number" },
  { key: "acwTimeSec", label: "ACW Time", type: "number" },
  { key: "avgTalkTimeSec", label: "Avg Talk Time", type: "number" },
  { key: "avgAcwTimeSec", label: "Avg ACW Time", type: "number" },
  { key: "refusals", label: "Refusals", type: "number" },
  { key: "heldPartyAbandons", label: "Held Party Abandons", type: "number" },
  { key: "transferToAgent", label: "Transfer to Agent", type: "number" },
  { key: "workingRatePct", label: "Working Rate", type: "number" }
];

/**
 * Compares two StaffingRecordsDialog rows by a single column, honoring the column's declared
 * type (string vs. number) and the requested direction. Null/undefined values always sort to
 * the end regardless of direction, so missing data never clutters the top of an ascending
 * sort - verified against representative sample rows (including null Refusals) before this
 * was written.
 */
function compareStaffingRecords(a, b, sortKey, sortDir, columnType) {
  const av = a[sortKey] ?? null;
  const bv = b[sortKey] ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;

  const cmp = columnType === "string" ? String(av).localeCompare(String(bv)) : (av < bv ? -1 : av > bv ? 1 : 0);
  return sortDir === "asc" ? cmp : -cmp;
}

/**
 * Shared drill-down for all 6 EODB Dashboard widget tiles (Total Interactions, Handled,
 * Abandoned, Abandonment Rate, Wait Time Summary, Avg Talk Time) - shows the per-date Grand
 * Total values contributing to whichever tile was clicked, for the active Reporting Period.
 * Report totals remain authoritative; matching NICE raw calls are shown beneath them
 * with explicit coverage differences. Handled daily values are total minus abandoned.
 */
const eodbRecordColumns = [
  {key: "date", label: "Date", value: record => record.date},
  {key: "value", label: "Grand Total", value: record => record.value}
];

function EodbWidgetRecordsDialog({ open, onOpenChange, label, records, rawCalls }) {
  const [sort, setSort] = useState({key: "date", direction: "asc"});
  const sortedRecords = sortRecords(records, eodbRecordColumns, sort);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label} - EODB Dashboard</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {sortedRecords.length} day{sortedRecords.length === 1 ? "" : "s"} in the selected Reporting Period.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableRecordHeaders columns={eodbRecordColumns} sort={sort} onSort={setSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((r) => (
                <TableRow key={r.date}>
                  <TableCell>{formatDateLabel(r.date)}</TableCell>
                  <TableCell>{r.isPercent ? `${r.value}%` : formatNumber(r.value)}</TableCell>
                </TableRow>
              ))}
              {sortedRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">No data in this period.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {rawCalls && <NiceCallRecordsTable {...rawCalls} />}
      </DialogContent>
    </Dialog>
  );
}

function StaffingRecordsDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const sortedRows = sortKey
    ? [...rows].sort((a, b) => {
        const column = STAFFING_RECORDS_COLUMNS.find((c) => c.key === sortKey);
        return compareStaffingRecords(a, b, sortKey, sortDir, column?.type);
      })
    : [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.agentName.localeCompare(b.agentName));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Boise O&M - Contributing Records</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {sortedRows.length} agent-day record{sortedRows.length === 1 ? "" : "s"} in the selected Reporting Period. Select any column header to sort.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {STAFFING_RECORDS_COLUMNS.map((column) => (
                  <TableHead key={column.key}>
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(column)}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      {column.label}
                      {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r, i) => (
                <TableRow key={`${r.agentId}-${r.date}-${i}`}>
                  <TableCell>{formatDateLabel(r.date)}</TableCell>
                  <TableCell className="font-medium">{r.agentName}</TableCell>
                  <TableCell>{r.loginTimeSec !== null ? formatSecondsAsClock(r.loginTimeSec) : BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.acdContacts ?? BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.talkTimeSec !== null ? formatSecondsAsClock(r.talkTimeSec) : BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.acwTimeSec !== null ? formatSecondsAsClock(r.acwTimeSec) : BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.avgTalkTimeSec !== null ? formatSecondsAsClock(r.avgTalkTimeSec) : BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.avgAcwTimeSec !== null ? formatSecondsAsClock(r.avgAcwTimeSec) : BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.refusals ?? BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.heldPartyAbandons ?? BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.transferToAgent ?? BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.workingRatePct !== null ? `${r.workingRatePct}%` : BLANK_DISPLAY}</TableCell>
                </TableRow>
              ))}
              {sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="py-6 text-center text-muted-foreground">No staffing records in this period.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
/**
 * Shared comparator for the 2 new Incorta - O&M Email Report dialogs' sortable column headers. Named
 * distinctly (not reused from any other dialog's comparator) to guarantee zero naming
 * collision regardless of what other sorting-related code may or may not already exist in
 * this file from other in-progress work this session.
 */
function compareEmailBacklogSortValues(av, bv, sortDir) {
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = typeof av === "string" ? av.localeCompare(bv) : (av < bv ? -1 : av > bv ? 1 : 0);
  return sortDir === "asc" ? cmp : -cmp;
}

const EMAIL_DAILY_COLUMNS = [
  { key: "date", label: "Date", sortValue: (r) => r.date },
  { key: "emailCount", label: "# Emails", sortValue: (r) => r.emailCount },
  { key: "avgHandleTimeHours", label: "Avg Handle Time", sortValue: (r) => r.avgHandleTimeHours }
];

/**
 * Drill-down for the Total Emails / Avg Handle Time tiles - one row per calendar day, scoped
 * to the active Reporting Period. Sortable column headers from the start (same pattern
 * already proven on the Boise O&M drill-down).
 */
function EmailDailyRecordsDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const activeColumn = EMAIL_DAILY_COLUMNS.find((c) => c.key === sortKey);
  const sortedRows = activeColumn
    ? [...rows].sort((a, b) => compareEmailBacklogSortValues(activeColumn.sortValue(a), activeColumn.sortValue(b), sortDir))
    : [...rows].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incorta - O&M Email Report - Daily Volume &amp; Handle Time</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {sortedRows.length} day{sortedRows.length === 1 ? "" : "s"} in the selected Reporting Period. Select any column header to sort.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {EMAIL_DAILY_COLUMNS.map((column) => (
                  <TableHead key={column.key}>
                    <button type="button" onClick={() => handleHeaderClick(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                      {column.label}
                      {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r, i) => (
                <TableRow key={`${r.date}-${i}`}>
                  <TableCell>{formatDateLabel(r.date)}</TableCell>
                  <TableCell>{formatNumber(r.emailCount)}</TableCell>
                  <TableCell>{r.avgHandleTimeHours !== null ? formatSecondsAsClock(Math.round(r.avgHandleTimeHours * 3600)) : BLANK_DISPLAY}</TableCell>
                </TableRow>
              ))}
              {sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">No email volume data in this period.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_CASE_COLUMNS = [
  { key: "caseNumber", label: "Case #", sortValue: (r) => r.caseNumber },
  { key: "ownerName", label: "Owner", sortValue: (r) => r.ownerName },
  { key: "subject", label: "Subject", sortValue: (r) => r.subject },
  { key: "status", label: "Status", sortValue: (r) => r.status },
  { key: "createdDateIso", label: "Created", sortValue: (r) => r.createdDateIso },
  { key: "ageDays", label: "Age (days)", sortValue: (r) => r.ageDays }
];

/**
 * Drill-down for the Open Backlog / Oldest Open Case tiles - one row per OPEN case (live
 * snapshot, not Reporting-Period-scoped, matching the tiles' own semantics). Defaults to
 * sorted by Age descending (oldest/most urgent first) rather than the more generic "sort by
 * nothing until clicked" default used elsewhere, since that's the most useful starting view
 * for a backlog list specifically.
 */
function EmailCaseRecordsDialog({ open, onOpenChange, rows }) {
  const [sortKey, setSortKey] = useState("ageDays");
  const [sortDir, setSortDir] = useState("desc");

  function handleHeaderClick(column) {
    if (sortKey === column.key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir("asc");
    }
  }

  const activeColumn = EMAIL_CASE_COLUMNS.find((c) => c.key === sortKey);
  const sortedRows = activeColumn
    ? [...rows].sort((a, b) => compareEmailBacklogSortValues(activeColumn.sortValue(a), activeColumn.sortValue(b), sortDir))
    : rows;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incorta - O&M Email Report - Open Cases</DialogTitle>
        </DialogHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          {sortedRows.length} open case{sortedRows.length === 1 ? "" : "s"}, live snapshot (not scoped to the selected Reporting Period). Select any column header to sort.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {EMAIL_CASE_COLUMNS.map((column) => (
                  <TableHead key={column.key}>
                    <button type="button" onClick={() => handleHeaderClick(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
                      {column.label}
                      {sortKey === column.key && <span className="text-[10px]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r) => (
                <TableRow key={r.caseNumber}>
                  <TableCell className="font-medium"><CaseNumberLink caseNumber={r.caseNumber} fallback={BLANK_DISPLAY} className="font-medium" /></TableCell>
                  <TableCell>{r.ownerName || BLANK_DISPLAY}</TableCell>
                  <TableCell className="max-w-xs truncate" title={r.subject || ""}>{r.subject || BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.status || BLANK_DISPLAY}</TableCell>
                  <TableCell>{r.createdDateIso ? formatDateLabel(r.createdDateIso) : BLANK_DISPLAY}</TableCell>
                  <TableCell className={r.ageDays !== null && r.ageDays > 30 ? "text-rose-600 font-semibold" : ""}>{r.ageDays !== null ? r.ageDays.toFixed(1) : BLANK_DISPLAY}</TableCell>
                </TableRow>
              ))}
              {sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No open cases.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export default function DashboardOverview({
  records = [],
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
}) {
  const defaultPreset = useMemo(() => resolveDefaultPreset(records), [records]);
  const [rangeValue, setRangeValue] = useReportingPeriodPreference("overview");
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedPeriod = useMemo(() => {
    try {return {value: readSharedDashboardPeriod(searchParams), error: null};}
    catch (error) {return {value: null, error: error.message};}
  }, [searchParams]);
  useEffect(() => {
    if (sharedPeriod.error) toast.error(sharedPeriod.error);
  }, [sharedPeriod.error]);
  const sharedTileId = searchParams.get(SHARED_TILE_QUERY);
  const [localKpiMode, setLocalKpiMode] = useState(AGGREGATION_MODES.PERIOD_TOTAL);
  const kpiMode = sharedPeriod.value?.mode || localKpiMode;
  function clearSharedPeriod() {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete(SHARED_PERIOD_QUERY);
      next.delete(SHARED_TILE_QUERY);
      return next;
    }, {replace: true});
  }
  function changeRange(value) {
    setLocalKpiMode(kpiMode);
    setRangeValue(value);
    clearSharedPeriod();
  }
  function setKpiMode(value) {
    if (sharedPeriod.value) setRangeValue(sharedPeriod.value.range);
    setLocalKpiMode(value);
    clearSharedPeriod();
  }
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [drillDown, setDrillDown] = useState(null);
  const [quotesRequestedDialogOpen, setQuotesRequestedDialogOpen] = useState(false);
  const [quoteBacklogDialogOpen, setQuoteBacklogDialogOpen] = useState(false);
  const [interactionsDialogRows, setInteractionsDialogRows] = useState(null);
  const [staffingDialogRows, setStaffingDialogRows] = useState(null);
  const [eodbWidgetDialogRows, setEodbWidgetDialogRows] = useState(null);
  const [quoteActivitySelection, setQuoteActivitySelection] = useState(null);
  const [reportFilter, setReportFilter] = useState("all");
  const [emailDailyDialogRows, setEmailDailyDialogRows] = useState(null);
  const [emailCaseDialogRows, setEmailCaseDialogRows] = useState(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [tilePrefsVersion, setTilePrefsVersion] = useState(0);

  const activeRange = useMemo(() => {
    if (sharedPeriod.value) return sharedPeriod.value.range;
    if (rangeValue) return rangeValue;
    const resolved = resolveDateRange({ preset: defaultPreset, records });
    return { preset: defaultPreset, start: resolved.start, end: resolved.end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeValue, defaultPreset, records, sharedPeriod.value]);

  const rangedRecords = useMemo(() => filterRecordsInRange(records, activeRange), [records, activeRange]);
  const previousRange = useMemo(() => getPreviousPeriodRange(activeRange), [activeRange]);
  const previousRangedRecords = useMemo(
    () => (previousRange ? filterRecordsInRange(records, previousRange) : []),
    [records, previousRange]
  );

  const quotesQuery = useQuery({
    queryKey: ["quotes", "executive-overview"],
    queryFn: async () => {
      const quotes = await getQuotes();
      if (!Array.isArray(quotes)) throw new Error("Quote service returned an invalid response.");
      return quotes;
    }
  });
  const {data: allQuotes = [], isLoading: quotesLoading, isError: quotesError} = quotesQuery;
  const activityQuery = useQuery({
    queryKey: ["quoteActivity", "lifecycle"],
    queryFn: async () => {
      const activities = await getAllQuoteActivities();
      if (!Array.isArray(activities)) throw new Error("Quote activity service returned an invalid response.");
      return activities;
    }
  });
  const quoteActivityReport = useMemo(() => {
    if (quotesQuery.isLoading || quotesQuery.isError || activityQuery.isLoading || activityQuery.isError) return null;
    return buildQuoteLifecycleReport(allQuotes, {range: activeRange, activities: activityQuery.data || []});
  }, [allQuotes, activeRange, quotesQuery.isLoading, quotesQuery.isError, activityQuery.data, activityQuery.isLoading, activityQuery.isError]);

  // Report Data Tables (SFDC-Quotes, Escalations, etc.) - a separate store from the date-ranged
  // daily metrics above. Read-only here; nothing on this page writes to it. Refetches whenever
  // this tab remounts (e.g. switching back from Report Data after a new import), consistent with
  // how allQuotes above already relies on remount-triggered refetching.
  const { data: reportTables = {} } = useQuery({
    queryKey: ["report-tables-for-ops-overview"],
    queryFn: listReportTables
  });

  const sfdcQuotesTable = reportTables?.sfdc_quotes ?? null;
  const niceCalls = useMemo(() => niceCallContributingRecords(reportTables?.incorta_input?.rows || [], activeRange), [reportTables, activeRange]);
  function openEodbRecords(label, records, outcome, expected) {
    const dates = new Set(records.map(record => record.date));
    const total = computeEodbWidgetTotal(rangedEodbTotalCallVolume.filter(record => dates.has(record.date)));
    const abandoned = computeEodbWidgetTotal(rangedEodbAbandonedCalls.filter(record => dates.has(record.date)));
    const reportCount = outcome === "Abandoned" ? abandoned : outcome === "Handled"
      ? total !== null && abandoned !== null ? total - abandoned : null : total;
    setEodbWidgetDialogRows({
      label, records,
      rawCalls: {
        records: niceCalls.records.filter(call => dates.has(call.date) && (!outcome || call.outcome === outcome)),
        expected: reportCount ?? expected, undated: niceCalls.undated, available: Boolean(reportTables?.incorta_input)
      }
    });
  }
  // Incorta - O&M Email Report (Pronto Metrics Dashboard / O&M Email Cases) - two related but distinct
  // data shapes from two separate report exports: "Email Raw Data" (one row per CASE, used
  // for live backlog/aging figures - NOT date-filtered, since an open case from months ago is
  // still part of today's backlog regardless of which Reporting Period is selected) and
  // "Daily Email Volume & AHT" (one row per CALENDAR DAY, used for period-aware Total
  // Emails/Avg Handle Time tiles, filtered the same way daily-metrics records already are).
  const emailCaseRecords = useMemo(
    () => getEmailBacklogRecordsFromStoredRows(reportTables?.email_cases?.rows || []),
    [reportTables]
  );
  const emailDailyRecords = useMemo(
    () => parseEmailBacklogDailyRows(reportTables?.email_daily?.rows || []),
    [reportTables]
  );
  const rangedEmailDailyRecords = useMemo(
    () => displayModeRecords(emailDailyRecords, activeRange, kpiMode),
    [emailDailyRecords, activeRange, kpiMode]
  );
  const emailBacklogTotals = useMemo(
    () => computeEmailBacklogTotals(rangedEmailDailyRecords, emailCaseRecords),
    [rangedEmailDailyRecords, emailCaseRecords]
  );
  const openEmailCases = useMemo(
    () => emailCaseRecords.filter((c) => !c.isClosed).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)),
    [emailCaseRecords]
  );

  // Staffing (OM Staffing Report) - TEAM TOTALS ONLY for Executive Overview, per explicit
  // scope confirmation. Per-agent breakdown is a Staffing-tab concern, not shown here.
  // Converts already-stored staffing rows back into typed per-agent-day records (same shape
  // parseOMStaffingCsv produces from a fresh CSV), then scopes to the active Reporting Period
  // using the same filterRecordsInRange() already used for daily-metrics records above.
  const staffingRecords = useMemo(
    () => getRecordsFromStoredRowsV2(reportTables?.staffing?.rows || []),
    [reportTables]
  );
  const rangedStaffingRecords = useMemo(
    () => displayModeRecords(staffingRecords, activeRange, kpiMode),
    [staffingRecords, activeRange, kpiMode]
  );
  const staffingTeamTotals = useMemo(
    () => {
      const totals = computeStaffingTeamTotalsV2(rangedStaffingRecords);
      if (!totals) return totals;
      return {...totals,
        totalAcdContacts: dailyCountValue(totals.totalAcdContacts, rangedStaffingRecords, kpiMode),
        totalRefusals: dailyCountValue(totals.totalRefusals, rangedStaffingRecords, kpiMode),
        totalHeldPartyAbandons: dailyCountValue(totals.totalHeldPartyAbandons, rangedStaffingRecords, kpiMode),
        totalTransferToAgent: dailyCountValue(totals.totalTransferToAgent, rangedStaffingRecords, kpiMode)
      };
    },
    [rangedStaffingRecords, kpiMode]
  );



  const quotesRequestedRows = useMemo(() => {
    if (!sfdcQuotesTable?.rows) return [];
    return sfdcQuotesTable.rows.filter(
      row => String(row[SFDC_OM_STATUS_COLUMN] ?? "").trim().toLowerCase() === QUOTE_REQUESTED_VALUE
    );
  }, [sfdcQuotesTable]);
  // "Quote Backlog" per user's confirmed definition: any quote that currently has an active
  // Alert (per quoteSLA.js's own computeQuoteAlert - the same logic already shown on individual
  // quote cards via SLAAlertBadge). Both yellow and red alerts count together as one combined
  // number, per explicit confirmation ("Any quote that has an 'Alerts' flag. There are currently
  // 26 of them."). Live from EnQuote's own quote records - not from any imported report.
  const quoteBacklogAlertRows = useMemo(() => {
    if (quotesLoading || quotesError) return [];
    return allQuotes
      .filter(isReportableQuote)
      .map(quote => ({ quote, alert: computeQuoteAlert(quote) }))
      .filter(entry => entry.alert !== null);
  }, [allQuotes, quotesLoading, quotesError]);
  // "Call Interactions" - live from Incorta-O&M-Input, respects the selected Reporting Period.
  // Classification uses Incorta's OWN pre-computed "Handled"/"Abandons" columns directly
  // (confirmed from a real imported row: Handled="1" XOR Abandons="1") - no guessing. Uses a
  // MORE PERMISSIVE date parser than the older callVolumeRawOverrides.js (accepts 2-4 digit
  // years, optional seconds, optional AM/PM) specifically to avoid silently dropping rows whose
  // date format varies slightly - the root cause traced for the prior Calls Abandoned undercount.
  const interactionRows = useMemo(() => {
    const rows = reportTables?.incorta_input?.rows || [];
    return rows.filter((row) => {
      const dateKey = Object.keys(row || {}).find((k) => k.trim().toLowerCase() === "contact start time (pst)");
      if (!dateKey) return false;
      const raw = String(row[dateKey] ?? "").trim();
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) return false;
      const month = m[1].padStart(2, "0");
      const day = m[2].padStart(2, "0");
      let year = m[3];
      if (year.length === 2) year = `20${year}`;
      const date = `${year}-${month}-${day}`;
      if (activeRange?.start && date < activeRange.start) return false;
      if (activeRange?.end && date > activeRange.end) return false;
      return true;
    });
  }, [reportTables, activeRange]);
  const interactionStats = useMemo(() => {
    let handled = 0;
    let abandoned = 0;
    let waitSum = 0;
    let waitCount = 0;
    let talkSum = 0;
    let talkCount = 0;
    interactionRows.forEach((row) => {
      const isHandled = String(row["Handled"] ?? "").trim() === "1";
      const isAbandoned = String(row["Abandons"] ?? "").trim() === "1";
      if (isHandled) handled += 1;
      if (isAbandoned) abandoned += 1;
      const wait = Number.parseFloat(row["Wait_Time(Sec)"]);
      if (Number.isFinite(wait)) { waitSum += wait; waitCount += 1; }
      if (isHandled) {
        const talk = Number.parseFloat(row["Talktime(Sec)"]);
        if (Number.isFinite(talk)) { talkSum += talk; talkCount += 1; }
      }
    });
    return {
      total: interactionRows.length,
      handled,
      abandoned,
      avgWaitSeconds: waitCount > 0 ? waitSum / waitCount : null,
      avgTalkSeconds: talkCount > 0 ? talkSum / talkCount : null
    };
  }, [interactionRows]);

  // EODB Dashboard pivoted-widget derivations - see parseEodbWidget.js for the full
  // explanation of why these tiles moved off raw-row counting. Each widget's ALREADY-STORED
  // rows (from Report Data tab imports) are converted to { date, value } records, filtered to
  // the active Reporting Period the same way every other period-aware tile already is, then
  // aggregated (summed for plain counts, averaged for the percent-based Abandonment Rate
  // widget - see computeEodbWidgetTotal).
  const rangedEodbTotalCallVolume = useMemo(
    () => displayModeRecords(getEodbWidgetRecordsFromStoredRows(reportTables?.eodb_total_call_volume?.rows || []), activeRange, kpiMode),
    [reportTables, activeRange, kpiMode]
  );
  const rangedEodbAbandonedCalls = useMemo(
    () => displayModeRecords(getEodbWidgetRecordsFromStoredRows(reportTables?.eodb_abandoned_calls?.rows || []), activeRange, kpiMode),
    [reportTables, activeRange, kpiMode]
  );
  const rangedEodbAbandonmentRate = useMemo(
    // FIX (real bug, confirmed live: a multi-day Reporting Period showed 431% instead of
    // the correct ~16-20% average) - Abandonment Rate's stored values are plain decimal
    // numbers with no "%" suffix, so the parser could never reliably auto-detect this as a
    // percent-type widget on its own. Passing `true` explicitly tells it definitively,
    // since THIS specific report type is the only one of the 5 EODB widgets that is a rate.
    () => filterRecordsInRange(getEodbWidgetRecordsFromStoredRows(reportTables?.eodb_abandonment_rate?.rows || [], true), activeRange),
    [reportTables, activeRange]
  );
  const rangedEodbDailyWaitTime = useMemo(
    () => displayModeRecords(getEodbWidgetRecordsFromStoredRows(reportTables?.eodb_daily_wait_time?.rows || []), activeRange, kpiMode),
    [reportTables, activeRange, kpiMode]
  );
  const rangedEodbAvgTalkTime = useMemo(
    () => displayModeRecords(getEodbWidgetRecordsFromStoredRows(reportTables?.eodb_avg_talk_time?.rows || []), activeRange, kpiMode),
    [reportTables, activeRange, kpiMode]
  );

  const eodbTotalInteractions = useMemo(() => displayCount(rangedEodbTotalCallVolume, kpiMode), [rangedEodbTotalCallVolume, kpiMode]);
  const eodbAbandoned = useMemo(() => displayCount(rangedEodbAbandonedCalls, kpiMode), [rangedEodbAbandonedCalls, kpiMode]);
  const eodbHandledRecords = useMemo(() => rangedEodbTotalCallVolume.map(record => {
    const abandoned = rangedEodbAbandonedCalls.find(item => item.date === record.date);
    return {...record, value: abandoned ? record.value - abandoned.value : null};
  }), [rangedEodbTotalCallVolume, rangedEodbAbandonedCalls]);
  const eodbHandled = useMemo(() => displayCount(eodbHandledRecords, kpiMode), [eodbHandledRecords, kpiMode]);
  // Abandonment Rate is confirmed (via direct inspection of real stored data) to be stored as
  // a raw decimal FRACTION (e.g. 0.18055555555555555 for 9/9), not a string with a "%" sign -
  // multiplying by 100 here converts it into the plain percentage number the tile displays
  // (rounded to 1 decimal place, e.g. 18.1). Verified against real values: 0.18055... -> 18.1,
  // 0.12857... -> 12.9.
  // Rounds to a WHOLE percent (e.g. 23%, not 22.8%) to match Incorta's own displayed
  // convention exactly - confirmed via direct side-by-side comparison against the real
  // Incorta report: our app previously showed 22.8%/14.9% for 8/20/8/19 (mathematically more
  // precise) while Incorta itself shows 23%/15% (rounded to whole percent) - this was not a
  // calculation bug, just a different rounding convention, and whole-percent was chosen to
  // eliminate that visual mismatch when cross-checking against the source report directly.
  // FIX (real bug, confirmed against Incorta's own numbers): averaging each day's ALREADY-
  // COMPUTED Abandonment Rate percentage across a multi-day period does NOT match Incorta's
  // own methodology. Confirmed directly: Incorta's own daily "Grand Total" row is a
  // VOLUME-WEIGHTED combination of the underlying skills (e.g. 13%/7% for 2 skills combines
  // to 9%, not the simple average of 10%) - and Incorta's own multi-day period "Total"
  // column applies that SAME weighting principle across days, not a simple average of daily
  // rates (confirmed: 6 real daily rates averaging to 15.3% simple-average, while Incorta's
  // own Total column for that same period shows 20%). The correct period-level rate is
  // (total abandoned calls across the period) / (total call volume across the period) - we
  // already compute both of these correctly as SUMS via eodbTotalInteractions/eodbAbandoned
  // above, so this reuses them directly instead of re-deriving anything from the
  // Abandonment Rate widget's own daily percentages.
  const eodbAbandonmentRate = useMemo(
    () => {
      const total = computeEodbWidgetTotal(rangedEodbTotalCallVolume);
      const abandoned = computeEodbWidgetTotal(rangedEodbAbandonedCalls);
      if (total === null || abandoned === null || total === 0) return null;
      return Math.round((abandoned / total) * 100);
    },
    [rangedEodbTotalCallVolume, rangedEodbAbandonedCalls]
  );
  // Daily Wait Time Summary / Average Talk Time(Phone) are confirmed (via direct inspection of
  // real stored data) to be stored as decimal MINUTES (e.g. 5.889502314814814 for 9/9 Wait
  // Time, 11.20523305084746 for 9/9 Talk Time - both plausible real-world call-center
  // durations). Multiplying by 60 converts to whole seconds for formatSecondsAsClock, replacing
  // the earlier "(raw unit - verify)" placeholder now that the real unit is confirmed.
  // Verified: 5.8895 min -> 353 sec -> "5m 53s"; 11.2052 min -> 672 sec -> "11m 12s".
  // Rounds to 1 decimal place FIRST (matching Incorta's OWN display precision for these
  // widgets - confirmed via direct comparison: Incorta's own table shows "11.6" for a real
  // stored value of 11.627487055016184, since Incorta itself rounds to 1 decimal before
  // display), THEN converts that rounded value to whole seconds - per explicit request to
  // guarantee EnQuote's displayed minutes:seconds always matches what you'd get by
  // hand-converting Incorta's own rounded number, rather than showing extra precision
  // Incorta's own UI doesn't expose. Verified: 11.627487... -> rounds to 11.6 -> 11:36
  // (previously showed 11:38 using full, un-rounded precision).
  const eodbAvgWaitSeconds = useMemo(
    () => {
      if (!rangedEodbDailyWaitTime.length) return null;
      const avgMinutes = computeEodbWidgetTotal(rangedEodbDailyWaitTime) / rangedEodbDailyWaitTime.length;
      const roundedToIncortaPrecision = Math.round(avgMinutes * 10) / 10;
      return Math.round(roundedToIncortaPrecision * 60);
    },
    [rangedEodbDailyWaitTime]
  );
  const eodbAvgTalkSeconds = useMemo(
    () => {
      if (!rangedEodbAvgTalkTime.length) return null;
      const avgMinutes = computeEodbWidgetTotal(rangedEodbAvgTalkTime) / rangedEodbAvgTalkTime.length;
      const roundedToIncortaPrecision = Math.round(avgMinutes * 10) / 10;
      return Math.round(roundedToIncortaPrecision * 60);
    },
    [rangedEodbAvgTalkTime]
  );

  const quoteOpsSeries = useMemo(() => {
    if (quotesLoading || quotesError) return [];
    return rangedRecords.map(record => {
      const m = computeQuoteOpsMetrics(allQuotes, record.date, { completedStatuses });
      return { date: record.date, quotesDrafted: m.quotesDrafted, quotesCompleted: m.quotesCompleted, backlogStart: m.backlogStart, backlogEnd: m.backlogEnd };
    });
  }, [rangedRecords, allQuotes, completedStatuses, quotesLoading, quotesError]);

  const previousQuoteOpsSeries = useMemo(() => {
    if (quotesLoading || quotesError) return [];
    return previousRangedRecords.map(record => {
      const m = computeQuoteOpsMetrics(allQuotes, record.date, { completedStatuses });
      return { date: record.date, quotesDrafted: m.quotesDrafted, quotesCompleted: m.quotesCompleted, backlogStart: m.backlogStart, backlogEnd: m.backlogEnd };
    });
  }, [previousRangedRecords, allQuotes, completedStatuses, quotesLoading, quotesError]);

  function openDrillDown({ title, fieldLabel, fieldKey, source }) {
    setDrillDown({ title, fieldLabel, fieldKey, records: source });
  }

  const primaryResults = useMemo(() => PRIMARY_KPI_DEFINITIONS
    .map(def => ({ def, result: computeKpiResult(def, rangedRecords, previousRangedRecords, quoteOpsSeries, previousQuoteOpsSeries, kpiMode) }))
    .filter(({ result }) => result.current !== null),
  [rangedRecords, previousRangedRecords, quoteOpsSeries, previousQuoteOpsSeries, kpiMode]);

  const secondaryResults = useMemo(() => SECONDARY_KPI_DEFINITIONS
    .map(def => ({ def, result: computeKpiResult(def, rangedRecords, previousRangedRecords, quoteOpsSeries, previousQuoteOpsSeries, kpiMode) }))
    .filter(({ result }) => result.current !== null),
  [rangedRecords, previousRangedRecords, quoteOpsSeries, previousQuoteOpsSeries, kpiMode]);


  const caseBacklog = useMemo(() => {
    const opening = resolveOpeningBacklog(seriesFor(rangedRecords, "case_backlog_start"));
    const closing = resolveClosingBacklog(seriesFor(rangedRecords, "case_backlog_end"));
    const prevOpening = resolveOpeningBacklog(seriesFor(previousRangedRecords, "case_backlog_start"));
    const prevClosing = resolveClosingBacklog(seriesFor(previousRangedRecords, "case_backlog_end"));
    return { opening, closing, net: computeNetBacklogMovement(opening, closing), prevNet: computeNetBacklogMovement(prevOpening, prevClosing) };
  }, [rangedRecords, previousRangedRecords]);



  // Unified, customizable tile registry - reorganizes tiles already computed above
  // (primaryResults, secondaryResults, quoteBacklogAlertRows, quotesRequestedRows,
  // caseBacklog, interactionStats) into one flat list. No new calculations here -
  // purely presentation. "category" reuses each tile's existing sourceLabel concept
  // so the Report filter dropdown and this registry always agree.
  const allTiles = useMemo(() => {
    const tiles = [];
    tiles.push({
      id: "improper_quote_requests",
      label: "Improper Quote Requests",
      category: "Live from EnQuote",
      render: () => <ImproperQuoteRequestsTile range={activeRange} mode={kpiMode} />
    });
    primaryResults.forEach(({ def, result }) => {
      tiles.push({
        id: def.key,
        label: def.label,
        category: def.sourceLabel,
        render: () => (
          <KpiCard
            def={def}
            result={result}
            showComparison={compareEnabled && Boolean(previousRange)}
            onViewRecords={() => openDrillDown({ title: def.label, fieldLabel: def.label, fieldKey: def.fieldKey || null, source: rangedRecords })}
          />
        )
      });
    });
    for (const [metric, label] of [["created", "Quotes Created"], ["worked", "Quotes Worked"]]) {
      const display = quoteActivityReport ? quoteDisplayMetric(quoteActivityReport, metric, activeRange, kpiMode) : null;
      tiles.push({
        id: `quotes_${metric}_period`,
        label,
        category: "Live from EnQuote",
        render: () => <QuotePeriodActivityTile
          metric={metric}
          report={quoteActivityReport}
          mode={kpiMode}
          display={display}
          loading={quotesLoading || activityQuery.isLoading}
          error={quotesQuery.isError ? quotesQuery.error : activityQuery.isError ? activityQuery.error : null}
          onRetry={() => { quotesQuery.refetch(); activityQuery.refetch(); }}
          onViewRecords={() => setQuoteActivitySelection({label: `${label} (${MODE_LABELS[kpiMode]})`, records: quoteContributingRecords({...quoteActivityReport, activity: display.activity}, metric)})}
        />
      });
    }
    tiles.push({
      id: "quote_backlog",
      label: "Quote Backlog",
      category: "Live from EnQuote",
      render: () => (
        <LiveCountCard
          label="Quote Backlog"
          icon={Layers}
          iconClass="bg-fuchsia-50 text-fuchsia-600"
          count={quoteBacklogAlertRows.length}
          sourceLabel="Live from EnQuote - quotes with an active Alert"
          onViewRecords={() => setQuoteBacklogDialogOpen(true)}
        />
      )
    });
    if (sfdcQuotesTable) {
      tiles.push({
        id: "quotes_requested",
        label: "Quotes Requested",
        category: "SFDC-Quotes import",
        render: () => (
          <LiveCountCard
            label="Quotes Requested"
            icon={FileText}
            iconClass="bg-cyan-50 text-cyan-600"
            count={quotesRequestedRows.length}
            sourceLabel="SFDC-Quotes import"
            onViewRecords={() => setQuotesRequestedDialogOpen(true)}
          />
        )
      });
    }
    secondaryResults.forEach(({ def, result }) => {
      tiles.push({
        id: def.key,
        label: def.label,
        category: def.sourceLabel,
        render: () => (
          <KpiCard
            def={def}
            result={result}
            showComparison={compareEnabled && Boolean(previousRange)}
            onViewRecords={() => openDrillDown({ title: def.label, fieldLabel: def.label, fieldKey: def.fieldKey || null, source: rangedRecords })}
          />
        )
      });
    });
    tiles.push({
      id: "om_case_backlog",
      label: "O&M Case Backlog",
      category: "Case Backlog",
      render: () => (
        <BacklogCard
          label="O&M Case Backlog"
          icon={HeartHandshake}
          iconClass="bg-sky-50 text-sky-600"
          backlog={caseBacklog}
          showComparison={compareEnabled && Boolean(previousRange)}
          direction="lowerIsBetter"
          onViewRecords={() => openDrillDown({ title: "O&M Case Backlog", fieldLabel: "Case Backlog at End", fieldKey: "case_backlog_end", source: rangedRecords })}
        />
      )
    });
    // Total Interactions / Handled / Abandoned / Abandonment Rate / Wait Time Summary / Avg
    // Talk Time are now sourced from Incorta's OWN pre-aggregated EODB Dashboard widgets
    // (Total Call Volume, # Abandoned Calls, Abandonment Rate, Daily Wait Time Summary,
    // Average Talk Time) rather than derived by counting raw NICE Call - RAW DATA rows. This
    // change was made after discovering a real, confirmed data-integrity issue: raw-row
    // counting produced an Abandoned figure exactly 2x Incorta's own trusted Grand Total
    // (52 vs. the real 26 for 9/9, cross-verified directly against the EODB widget's own
    // Grand Total row) - using Incorta's own pre-computed aggregates sidesteps that
    // discrepancy entirely, since these numbers come straight from the source system rather
    // than being re-derived from potentially-duplicated call-detail rows. Handled has no
    // widget of its own - it is computed as Total Interactions minus Abandoned, per explicit
    // confirmation, using these two trusted aggregate numbers.
    if (eodbTotalInteractions !== null) {
      tiles.push({
        id: "eodb_total_interactions",
        label: "Total Interactions",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Total Interactions"
            icon={Phone}
            iconClass="bg-indigo-50 text-indigo-600"
            value={formatNumber(eodbTotalInteractions)}
            sourceLabel="Total Call Volume (Handled + Abandoned) - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Total Interactions", rangedEodbTotalCallVolume, null, eodbTotalInteractions)}
            importedAt={reportTables?.eodb_total_call_volume?.importedAt}
            importMethod={reportTables?.eodb_total_call_volume?.importMethod}
          />
        )
      });
    }
    if (eodbHandled !== null) {
      tiles.push({
        id: "eodb_handled",
        label: "Handled",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Handled"
            icon={Phone}
            iconClass="bg-emerald-50 text-emerald-600"
            value={formatNumber(eodbHandled)}
            sourceLabel="Total Interactions minus Abandoned - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Handled (Total - Abandoned)", eodbHandledRecords, "Handled", computeEodbWidgetTotal(eodbHandledRecords))}
            importedAt={reportTables?.eodb_total_call_volume?.importedAt}
            importMethod={reportTables?.eodb_total_call_volume?.importMethod}
          />
        )
      });
    }
    if (eodbAbandoned !== null) {
      tiles.push({
        id: "eodb_abandoned",
        label: "Abandoned",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Abandoned"
            icon={PhoneOff}
            iconClass="bg-rose-50 text-rose-600"
            value={formatNumber(eodbAbandoned)}
            sourceLabel="# Abandoned Calls - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Abandoned", rangedEodbAbandonedCalls, "Abandoned", eodbAbandoned)}
            importedAt={reportTables?.eodb_abandoned_calls?.importedAt}
            importMethod={reportTables?.eodb_abandoned_calls?.importMethod}
          />
        )
      });
    }
    if (eodbAbandonmentRate !== null) {
      tiles.push({
        id: "eodb_abandonment_rate",
        label: "Abandonment Rate",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Abandonment Rate"
            icon={TriangleAlert}
            iconClass="bg-amber-50 text-amber-600"
            value={`${eodbAbandonmentRate}%`}
            sourceLabel="Abandoned / Total Interactions - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Abandonment Rate (Abandoned / Total)", rangedEodbAbandonedCalls, "Abandoned", eodbAbandoned)}
            importedAt={reportTables?.eodb_abandonment_rate?.importedAt}
            importMethod={reportTables?.eodb_abandonment_rate?.importMethod}
          />
        )
      });
    }
    if (eodbAvgWaitSeconds !== null) {
      tiles.push({
        id: "eodb_wait_time",
        label: "Wait Time Summary",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Wait Time Summary"
            icon={Phone}
            iconClass="bg-sky-50 text-sky-600"
            value={formatSecondsAsClock(eodbAvgWaitSeconds)}
            sourceLabel="Daily Wait Time Summary, avg/day - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Wait Time Summary", rangedEodbDailyWaitTime, null, eodbTotalInteractions)}
            importedAt={reportTables?.eodb_daily_wait_time?.importedAt}
            importMethod={reportTables?.eodb_daily_wait_time?.importMethod}
          />
        )
      });
    }
    if (eodbAvgTalkSeconds !== null) {
      tiles.push({
        id: "eodb_avg_talk_time",
        label: "Avg Talk Time",
        category: "Incorta-O&M-Input",
        render: () => (
          <StaffingStatCard
            label="Avg Talk Time"
            icon={Phone}
            iconClass="bg-violet-50 text-violet-600"
            value={formatSecondsAsClock(eodbAvgTalkSeconds)}
            sourceLabel="Average Talk Time(Phone), avg/day - EODB Dashboard"
            onViewRecords={() => openEodbRecords("Avg Talk Time", rangedEodbAvgTalkTime, "Handled", eodbTotalInteractions !== null && eodbAbandoned !== null ? eodbTotalInteractions - eodbAbandoned : null)}
            importedAt={reportTables?.eodb_avg_talk_time?.importedAt}
            importMethod={reportTables?.eodb_avg_talk_time?.importMethod}
          />
        )
      });
    }
    // Team Headcount can only be meaningfully shown for a SINGLE calendar day - summing
    // "distinct agents active" across a multi-day range would double-count nothing but also
    // says nothing about any one day's actual coverage. Restricted to single-day periods only,
    // per explicit request - hidden entirely (not shown as 0/blank) for any range selection.
    const isSingleDayPeriod = Boolean(activeRange?.start && activeRange?.end && activeRange.start === activeRange.end) || kpiMode === AGGREGATION_MODES.LATEST_DAY;
    if (staffingTeamTotals) {
      if (isSingleDayPeriod) {
        tiles.push({
          id: "staffing_headcount",
          label: "Team Headcount",
          category: "Boise O&M",
          render: () => (
            <StaffingStatCard
              label="Team Headcount"
              icon={Users}
              iconClass="bg-indigo-50 text-indigo-600"
              value={formatNumber(staffingTeamTotals.teamHeadcount)}
              sourceLabel="Distinct agents active this day - Boise O&M"
              onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords)}
            />
          )
        });
      }
      tiles.push({
        id: "staffing_avg_utilization",
        label: "Avg Team Utilization",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Avg Team Utilization"
            icon={TrendingUp}
            iconClass="bg-emerald-50 text-emerald-600"
            value={staffingTeamTotals.avgWorkingRatePct !== null ? `${staffingTeamTotals.avgWorkingRatePct}%` : "N/A"}
            sourceLabel="Working Rate, weighted by Login Time - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords)}
          />
        )
      });
      tiles.push({
        id: "staffing_total_contacts",
        label: "Total Contacts Handled",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Total Contacts Handled"
            icon={Phone}
            iconClass="bg-cyan-50 text-cyan-600"
            value={formatNumber(staffingTeamTotals.totalAcdContacts)}
            sourceLabel="Sum of ACD Contacts - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords)}
          />
        )
      });
      tiles.push({
        id: "staffing_avg_talk_time",
        label: "Avg Talk Time",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Avg Talk Time"
            icon={Phone}
            iconClass="bg-violet-50 text-violet-600"
            value={staffingTeamTotals.avgTalkTimeSec !== null ? formatSecondsAsClock(staffingTeamTotals.avgTalkTimeSec) : "N/A"}
            sourceLabel="Team Talk Time / ACD Contacts - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords)}
          />
        )
      });
      tiles.push({
        id: "staffing_avg_acw_time",
        label: "Avg ACW Time",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Avg ACW Time"
            icon={Clock}
            iconClass="bg-amber-50 text-amber-600"
            value={staffingTeamTotals.avgAcwTimeSec !== null ? formatSecondsAsClock(staffingTeamTotals.avgAcwTimeSec) : "N/A"}
            sourceLabel="Team ACW Time / ACD Contacts - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords)}
          />
        )
      });
      tiles.push({
        id: "staffing_refusals",
        label: "Refusals",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Refusals"
            icon={TriangleAlert}
            iconClass="bg-rose-50 text-rose-600"
            value={formatNumber(staffingTeamTotals.totalRefusals)}
            sourceLabel="Sum of Refusals - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords.filter((r) => r.refusals !== null && r.refusals > 0))}
          />
        )
      });
      tiles.push({
        id: "staffing_held_party_abandons",
        label: "Held Party Abandons",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Held Party Abandons"
            icon={TriangleAlert}
            iconClass="bg-rose-50 text-rose-600"
            value={formatNumber(staffingTeamTotals.totalHeldPartyAbandons)}
            sourceLabel="Sum of Held Party Abandons - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords.filter((r) => r.heldPartyAbandons !== null && r.heldPartyAbandons > 0))}
          />
        )
      });
      tiles.push({
        id: "staffing_transfer_to_agent",
        label: "Transfer to Agent",
        category: "Boise O&M",
        render: () => (
          <StaffingStatCard
            label="Transfer to Agent"
            icon={ArrowRight}
            iconClass="bg-slate-50 text-slate-600"
            value={formatNumber(staffingTeamTotals.totalTransferToAgent)}
            sourceLabel="Sum of Transfer to Agent - Boise O&M"
            onViewRecords={() => setStaffingDialogRows(rangedStaffingRecords.filter((r) => r.transferToAgent !== null && r.transferToAgent > 0))}
          />
        )
      });
    }
    if (rangedEmailDailyRecords.length > 0) {
      tiles.push({
        id: "email_total_emails",
        label: "Total Emails",
        category: "Incorta - O&M Email Report",
        render: () => (
          <StaffingStatCard
            label="Total Emails"
            icon={Mail}
            iconClass="bg-cyan-50 text-cyan-600"
            value={formatNumber(dailyCountValue(emailBacklogTotals.totalEmails, rangedEmailDailyRecords, kpiMode))}
            sourceLabel="Sum of # Emails, selected period - Incorta - O&M Email Report"
            onViewRecords={() => setEmailDailyDialogRows(rangedEmailDailyRecords)}
          />
        )
      });
      tiles.push({
        id: "email_avg_handle_time",
        label: "Avg Handle Time",
        category: "Incorta - O&M Email Report",
        render: () => (
          <StaffingStatCard
            label="Avg Handle Time"
            icon={Clock}
            iconClass="bg-violet-50 text-violet-600"
            value={emailBacklogTotals.avgHandleTimeHours !== null ? formatSecondsAsClock(Math.round(emailBacklogTotals.avgHandleTimeHours * 3600)) : "N/A"}
            sourceLabel="Emails-weighted average, selected period - Incorta - O&M Email Report"
            onViewRecords={() => setEmailDailyDialogRows(rangedEmailDailyRecords)}
          />
        )
      });
    }
    if (emailCaseRecords.length > 0) {
      tiles.push({
        id: "email_open_backlog",
        label: "Open Backlog",
        category: "Incorta - O&M Email Report",
        render: () => (
          <StaffingStatCard
            label="Open Backlog"
            icon={Mail}
            iconClass="bg-amber-50 text-amber-600"
            value={formatNumber(emailBacklogTotals.openBacklogCount)}
            sourceLabel={`0-7d: ${emailBacklogTotals.agingBuckets.days0to7} \u00b7 8-14d: ${emailBacklogTotals.agingBuckets.days8to14} \u00b7 15-30d: ${emailBacklogTotals.agingBuckets.days15to30} \u00b7 30+d: ${emailBacklogTotals.agingBuckets.days30plus} - Incorta - O&M Email Report`}
            onViewRecords={() => setEmailCaseDialogRows(openEmailCases)}
          />
        )
      });
      tiles.push({
        id: "email_oldest_open_case",
        label: "Oldest Open Case",
        category: "Incorta - O&M Email Report",
        render: () => (
          <StaffingStatCard
            label="Oldest Open Case"
            icon={TriangleAlert}
            iconClass="bg-rose-50 text-rose-600"
            value={emailBacklogTotals.oldestOpenAgeDays !== null ? `${Math.floor(emailBacklogTotals.oldestOpenAgeDays)}d` : "N/A"}
            sourceLabel="Days since created, live snapshot (not period-scoped) - Incorta - O&M Email Report"
            onViewRecords={() => setEmailCaseDialogRows(openEmailCases)}
          />
        )
      });
    }
    return tiles.map(tile => {
      const render = tile.render;
      const source = tile.id.startsWith("staffing_") ? rangedStaffingRecords
        : tile.id.startsWith("email_") && !["email_open_backlog", "email_oldest_open_case"].includes(tile.id) ? rangedEmailDailyRecords
          : tile.id === "eodb_wait_time" ? rangedEodbDailyWaitTime
            : tile.id === "eodb_avg_talk_time" ? rangedEodbAvgTalkTime
              : tile.id === "eodb_abandoned" ? rangedEodbAbandonedCalls
                : tile.id.startsWith("eodb_") ? rangedEodbTotalCallVolume : null;
      if (!source) return tile;
      const averageOnly = ["staffing_avg_utilization", "staffing_avg_talk_time", "staffing_avg_acw_time", "email_avg_handle_time", "eodb_wait_time", "eodb_avg_talk_time"].includes(tile.id);
      return {...tile, render: () => cloneElement(render(), {
        mode: averageOnly && kpiMode === AGGREGATION_MODES.PERIOD_TOTAL ? AGGREGATION_MODES.DAILY_AVERAGE : kpiMode,
        date: kpiMode === AGGREGATION_MODES.LATEST_DAY ? source[source.length - 1]?.date : null
      })};
    });
  }, [primaryResults, secondaryResults, compareEnabled, previousRange, rangedRecords, quoteBacklogAlertRows, sfdcQuotesTable, quotesRequestedRows, caseBacklog, interactionStats, staffingTeamTotals, activeRange, rangedEmailDailyRecords, emailBacklogTotals, emailCaseRecords, openEmailCases, quoteActivityReport, quotesLoading, quotesQuery.isError, quotesQuery.error, quotesQuery.refetch, activityQuery.isLoading, activityQuery.isError, activityQuery.error, activityQuery.refetch, niceCalls, reportTables, eodbTotalInteractions, eodbAbandoned, rangedEodbTotalCallVolume, rangedEodbAbandonedCalls, rangedEodbDailyWaitTime, rangedEodbAvgTalkTime, eodbAbandonmentRate, eodbAvgWaitSeconds, eodbAvgTalkSeconds, kpiMode, rangedStaffingRecords, eodbHandled, eodbHandledRecords]);

  const tileCategories = useMemo(() => Array.from(new Set(allTiles.map((t) => t.category))), [allTiles]);

  const visibleOrderedTiles = useMemo(() => {
    const hidden = getHiddenTileIds();
    const filtered = allTiles.filter((t) => t.id === sharedTileId || (!hidden.has(t.id) && (reportFilter === "all" || t.category === reportFilter)));
    const savedOrder = getTileOrder();
    return orderTiles(filtered, savedOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTiles, reportFilter, tilePrefsVersion, sharedTileId]);

  function handleReorderTiles(newVisibleOrderIds) {
    const fullOrder = getTileOrder().length ? getTileOrder() : allTiles.map((t) => t.id);
    setTileOrder(applyPartialReorder(fullOrder, newVisibleOrderIds));
    setTilePrefsVersion((v) => v + 1);
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O&M Executive Overview</CardTitle>
          <p className="text-sm text-muted-foreground">
            Period metrics from imports and live EnQuote activity, followed by actionable quote exceptions.
            See Quote Dashboard for full quote charts and history.
          </p>
        </CardHeader>
      </Card>
      <DashboardDateRange records={records} value={activeRange} onChange={changeRange}
        freezePresetDates={Boolean(sharedPeriod.value)} />
      <Card className="border-border">
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">KPI Display Mode</Label>
            <ToggleGroup type="single" size="sm" value={kpiMode} onValueChange={(v) => v && setKpiMode(v)}>
              {AGGREGATION_MODE_OPTIONS.map(opt => (
                <ToggleGroupItem key={opt.value} value={opt.value} aria-label={opt.label}>{opt.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="compare-toggle" checked={compareEnabled} onCheckedChange={setCompareEnabled} disabled={!previousRange} />
            <Label htmlFor="compare-toggle" className="text-sm text-muted-foreground">
              Compare to Previous Period{!previousRange && " (not applicable to All Available History)"}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">Applies to period-based tiles. Snapshots and the live quote review queue stay unchanged. Rates and average durations are never summed. Quote daily averages include zero-activity calendar days; imported daily averages use available report dates. Latest Day uses each source&apos;s latest available date (quotes use the period end).</p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">Metrics</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={reportFilter} onValueChange={setReportFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reports</SelectItem>
              {tileCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={() => setCustomizeOpen(true)}>
            Customize Tiles
          </Button>
        </div>
      </div>
      {visibleOrderedTiles.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tiles to show for this selection - try a different report filter, or re-enable tiles via Customize Tiles.
          </CardContent>
        </Card>
      ) : (
        <TileGrid tiles={visibleOrderedTiles} onReorder={handleReorderTiles}
          sharePath={id => sharedDashboardTilePath(id, activeRange, kpiMode)} />
      )}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-foreground">Hourly Wait Time Summary</h3>
        <HourlyWaitTimeChart rows={reportTables?.eodb_hourly_wait_time?.rows} />
      </div>
      <QuoteExceptionsPanel
        report={quoteActivityReport}
        alertRows={quoteBacklogAlertRows}
        loading={quotesLoading || activityQuery.isLoading}
        error={quotesQuery.isError ? quotesQuery.error : activityQuery.isError ? activityQuery.error : null}
        onRetry={() => { quotesQuery.refetch(); activityQuery.refetch(); }}
      />
      <DrillDownDrawer
        open={Boolean(drillDown)}
        onOpenChange={(open) => { if (!open) setDrillDown(null); }}
        title={drillDown?.title}
        fieldLabel={drillDown?.fieldLabel}
        fieldKey={drillDown?.fieldKey}
        records={drillDown?.records || []}
      />
      <QuotesRequestedDialog
        open={quotesRequestedDialogOpen}
        onOpenChange={setQuotesRequestedDialogOpen}
        rows={quotesRequestedRows}
      />
      <QuoteBacklogAlertDialog
        open={quoteBacklogDialogOpen}
        onOpenChange={setQuoteBacklogDialogOpen}
        rows={quoteBacklogAlertRows}
      />
      <InteractionsDialog
        open={interactionsDialogRows !== null}
        onOpenChange={(open) => { if (!open) setInteractionsDialogRows(null); }}
        rows={interactionsDialogRows || []}
      />
      <StaffingRecordsDialog
        open={staffingDialogRows !== null}
        onOpenChange={(open) => { if (!open) setStaffingDialogRows(null); }}
        rows={staffingDialogRows || []}
      />
      <EodbWidgetRecordsDialog
        open={eodbWidgetDialogRows !== null}
        onOpenChange={(open) => { if (!open) setEodbWidgetDialogRows(null); }}
        label={eodbWidgetDialogRows?.label || ""}
        records={eodbWidgetDialogRows?.records || []}
        rawCalls={eodbWidgetDialogRows?.rawCalls}
      />
      <QuoteContributingRecordsDialog selection={quoteActivitySelection} onClose={() => setQuoteActivitySelection(null)} />
      <EmailDailyRecordsDialog
        open={emailDailyDialogRows !== null}
        onOpenChange={(open) => { if (!open) setEmailDailyDialogRows(null); }}
        rows={emailDailyDialogRows || []}
      />
      <EmailCaseRecordsDialog
        open={emailCaseDialogRows !== null}
        onOpenChange={(open) => { if (!open) setEmailCaseDialogRows(null); }}
        rows={emailCaseDialogRows || []}
      />
      <TileCustomizationDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        tiles={allTiles}
        onChanged={() => setTilePrefsVersion((v) => v + 1)}
      />
    </div>
  );
}
