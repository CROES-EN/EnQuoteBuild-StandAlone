import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  HeartHandshake,
  Layers,
  Minus,
  Phone,
  PhoneOff,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getQuotes } from "@/api/dataClient";
import {
  formatDateLabel,
  formatNumber,
  formatRate,
  formatSecondsAsClock
} from "@/features/supervisorDashboard/format";
import {
  describeRangeCoverage,
  filterRecordsInRange,
  getPreviousPeriodRange,
  resolveDateRange,
  resolveDefaultPreset
} from "@/features/supervisorDashboard/dateRanges";
import {
  AGGREGATION_MODES,
  AGGREGATION_MODE_OPTIONS,
  aggregateMetric,
  comparePeriods,
  computeNetBacklogMovement,
  computeRateFromTotals,
  resolveClosingBacklog,
  resolveOpeningBacklog
} from "@/features/supervisorDashboard/periodAggregation";
import {
  computeOverallCoverage,
  computeSourceCoverage,
  getRecordsForGroup
} from "@/features/supervisorDashboard/sourceCoverage";
import {
  computeQuoteOpsMetrics,
  DEFAULT_COMPLETED_STATUSES
} from "@/features/supervisorDashboard/quoteOpsMetrics";
import DashboardDateRange from "@/components/supervisor/DashboardDateRange";
import ExecutiveOverviewCharts from "@/components/supervisor/ExecutiveOverviewCharts";
import RequiresAttentionTable from "@/components/supervisor/RequiresAttentionTable";
import DrillDownDrawer from "@/components/supervisor/DrillDownDrawer";
import MetricsTrendCharts from "@/components/supervisor/MetricsTrendCharts";
import MetricsHistoryTable from "@/components/supervisor/MetricsHistoryTable";

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

// Priority 1-7 per the O&M reporting spec's KPI ROW list, adapted to what this data model can
// actually compute today - "Opening Quote Backlog" (priority 8) is folded into the combined
// Quote Backlog card below instead of a standalone tile, so the primary row still respects the
// spec's "up to eight cards" cap while showing Opening/Closing/Net together.
const PRIMARY_KPI_DEFINITIONS = [
  { key: "calls", label: "Calls Handled", icon: Phone, iconClass: "bg-indigo-50 text-indigo-600", kind: "field", fieldKey: "calls", additive: true, direction: "higherIsBetter", sourceLabel: "Contact Center" },
  { key: "calls_abandoned", label: "Calls Abandoned", icon: PhoneOff, iconClass: "bg-rose-50 text-rose-600", kind: "field", fieldKey: "calls_abandoned", additive: true, direction: "lowerIsBetter", sourceLabel: "Contact Center" },
  { key: "abandon_rate", label: "Abandon Rate", icon: PhoneOff, iconClass: "bg-orange-50 text-orange-600", kind: "rate", numeratorKey: "calls_abandoned", denominatorKey: "calls_offered", additive: false, direction: "lowerIsBetter", sourceLabel: "Recalculated from period totals" },
  { key: "avg_wait_seconds", label: "Average Wait Time", icon: Clock, iconClass: "bg-sky-50 text-sky-600", kind: "duration", fieldKey: "avg_wait_seconds", additive: false, direction: "lowerIsBetter", sourceLabel: "Contact Center" },
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
  if (!current) return "\u2014";
  if (def.kind === "duration") return formatSecondsAsClock(current.value);
  if (def.kind === "rate") return formatRate(current.value);
  return formatNumber(Math.round(current.value * 100) / 100);
}

function ComparisonNote({ comparison, direction }) {
  if (!comparison || !comparison.hasPrevious) {
    return <span className="text-xs text-slate-400">No prior period</span>;
  }
  if (comparison.previousWasZero) {
    return <span className="text-xs text-slate-500">Previous period value was zero</span>;
  }
  if (comparison.change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Minus className="h-3 w-3" /> No change
      </span>
    );
  }
  const isGood = direction === "neutral" ? null : (direction === "higherIsBetter" ? comparison.change > 0 : comparison.change < 0);
  const colorClass = isGood === null ? "text-slate-500" : (isGood ? "text-emerald-600" : "text-rose-600");
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
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${def.iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        {showComparison && <ComparisonNote comparison={comparison} direction={def.direction} />}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">{def.label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-900">{formatKpiValue(def, current)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-slate-200 bg-white text-[10px] text-slate-500">{MODE_LABELS[mode] || mode}</Badge>
        {mode === AGGREGATION_MODES.LATEST_DAY && current?.date && (
          <span className="text-[11px] text-slate-400">as of {formatDateLabel(current.date)}</span>
        )}
        {mode === AGGREGATION_MODES.DAILY_AVERAGE && current?.contributingCount && (
          <span className="text-[11px] text-slate-400">across {current.contributingCount} day{current.contributingCount === 1 ? "" : "s"}</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{def.sourceLabel}</p>
      {onViewRecords && (
        <button type="button" onClick={onViewRecords} className="mt-2 text-xs font-medium text-indigo-600 hover:underline">
          View contributing records
        </button>
      )}
    </div>
  );
}

function BacklogCard({ label, icon: Icon, iconClass, backlog, showComparison, direction, onViewRecords }) {
  const { opening, closing, net, prevNet } = backlog;
  const comparison = showComparison ? comparePeriods(net, prevNet) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        {showComparison && <ComparisonNote comparison={comparison} direction={direction} />}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-bold text-slate-900">{opening ? formatNumber(opening.value) : "\u2014"}</span>
        <span className="text-slate-400">{"\u2192"}</span>
        <span className="text-xl font-bold text-slate-900">{closing ? formatNumber(closing.value) : "\u2014"}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Net movement: {net !== null ? `${net > 0 ? "+" : ""}${formatNumber(net)}` : "\u2014"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-slate-200 bg-white text-[10px] text-slate-500">Point-in-Time</Badge>
        {opening && closing && (
          <span className="text-[11px] text-slate-400">{formatDateLabel(opening.date)} {"\u2192"} {formatDateLabel(closing.date)}</span>
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

function SourceCoverageBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span className="text-xs text-slate-400">Setup Required</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-slate-600">{percent}%</span>
    </div>
  );
}

export default function DashboardOverview({
  records = [],
  selectedDate,
  completedStatuses = DEFAULT_COMPLETED_STATUSES,
  onEditRecord,
  onChanged
}) {
  const defaultPreset = useMemo(() => resolveDefaultPreset(records), [records]);
  const [rangeValue, setRangeValue] = useState(null);
  const [kpiMode, setKpiMode] = useState(AGGREGATION_MODES.PERIOD_TOTAL);
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [drillDown, setDrillDown] = useState(null);

  const activeRange = useMemo(() => {
    if (rangeValue) return rangeValue;
    const resolved = resolveDateRange({ preset: defaultPreset, endDate: selectedDate, records });
    return { preset: defaultPreset, start: resolved.start, end: resolved.end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeValue, defaultPreset, records]);

  const rangedRecords = useMemo(() => filterRecordsInRange(records, activeRange), [records, activeRange]);
  const previousRange = useMemo(() => getPreviousPeriodRange(activeRange), [activeRange]);
  const previousRangedRecords = useMemo(
    () => (previousRange ? filterRecordsInRange(records, previousRange) : []),
    [records, previousRange]
  );
  const coverage = useMemo(() => describeRangeCoverage(records, activeRange), [records, activeRange]);

  const { data: allQuotes = [], isLoading: quotesLoading, isError: quotesError } = useQuery({
    queryKey: ["quotes-all-for-ops-metrics"],
    queryFn: getQuotes
  });

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

  const quoteBacklog = useMemo(() => {
    const opening = resolveOpeningBacklog(quoteOpsSeries.map(q => ({ date: q.date, value: q.backlogStart })));
    const closing = resolveClosingBacklog(quoteOpsSeries.map(q => ({ date: q.date, value: q.backlogEnd })));
    const prevOpening = resolveOpeningBacklog(previousQuoteOpsSeries.map(q => ({ date: q.date, value: q.backlogStart })));
    const prevClosing = resolveClosingBacklog(previousQuoteOpsSeries.map(q => ({ date: q.date, value: q.backlogEnd })));
    return { opening, closing, net: computeNetBacklogMovement(opening, closing), prevNet: computeNetBacklogMovement(prevOpening, prevClosing) };
  }, [quoteOpsSeries, previousQuoteOpsSeries]);

  const caseBacklog = useMemo(() => {
    const opening = resolveOpeningBacklog(seriesFor(rangedRecords, "case_backlog_start"));
    const closing = resolveClosingBacklog(seriesFor(rangedRecords, "case_backlog_end"));
    const prevOpening = resolveOpeningBacklog(seriesFor(previousRangedRecords, "case_backlog_start"));
    const prevClosing = resolveClosingBacklog(seriesFor(previousRangedRecords, "case_backlog_end"));
    return { opening, closing, net: computeNetBacklogMovement(opening, closing), prevNet: computeNetBacklogMovement(prevOpening, prevClosing) };
  }, [rangedRecords, previousRangedRecords]);

  const quoteOpsHasDataByDate = useMemo(
    () => Object.fromEntries(quoteOpsSeries.map(q => [q.date, isFiniteNumber(q.quotesDrafted) || isFiniteNumber(q.quotesCompleted)])),
    [quoteOpsSeries]
  );
  const sourceCoverageResults = useMemo(
    () => computeSourceCoverage(rangedRecords, { quoteOpsHasDataByDate }),
    [rangedRecords, quoteOpsHasDataByDate]
  );
  const overallCoverage = useMemo(() => computeOverallCoverage(sourceCoverageResults), [sourceCoverageResults]);

  const lastStoredOrImportedAt = useMemo(() => {
    let latest = null;
    rangedRecords.forEach(record => {
      const candidates = [record.updated_date, ...Object.values(record.sources || {}).map(s => s?.imported_at)].filter(Boolean);
      candidates.forEach(candidate => { if (!latest || candidate > latest) latest = candidate; });
    });
    return latest;
  }, [rangedRecords]);

  const attentionRows = useMemo(() => {
    const rows = [];

    if (quoteBacklog.net !== null && quoteBacklog.net > 0) {
      rows.push({
        key: "quote-backlog-increase",
        area: "Net Quote Backlog Increase",
        periodValue: `+${formatNumber(quoteBacklog.net)}`,
        change: null,
        coverage: `${formatDateLabel(quoteBacklog.opening.date)} \u2192 ${formatDateLabel(quoteBacklog.closing.date)}`,
        reason: "Review Recommended",
        source: "Quote Operations (live)",
        onViewRecords: () => openDrillDown({ title: "Net Quote Backlog Increase", fieldLabel: null, fieldKey: null, source: rangedRecords })
      });
    }

    if (caseBacklog.net !== null && caseBacklog.net > 0) {
      rows.push({
        key: "case-backlog-increase",
        area: "Net Case Backlog Increase",
        periodValue: `+${formatNumber(caseBacklog.net)}`,
        change: null,
        coverage: `${formatDateLabel(caseBacklog.opening.date)} \u2192 ${formatDateLabel(caseBacklog.closing.date)}`,
        reason: "Review Recommended",
        source: "Case Backlog",
        onViewRecords: () => openDrillDown({ title: "Net Case Backlog Increase", fieldLabel: "Case Backlog at End", fieldKey: "case_backlog_end", source: rangedRecords })
      });
    }

    if (coverage.missingDateCount > 0) {
      rows.push({
        key: "missing-snapshots",
        area: "Missing Daily Snapshots",
        periodValue: `${coverage.missingDateCount} missing`,
        change: null,
        coverage: `${coverage.snapshotCount} of ${coverage.totalCalendarDays} days stored`,
        reason: "Data Incomplete",
        source: "Daily Metrics Store",
        onViewRecords: () => openDrillDown({ title: "Missing Daily Snapshots", fieldLabel: null, fieldKey: null, source: rangedRecords })
      });
    }

    sourceCoverageResults.forEach(group => {
      if (group.status === "Full Coverage") return;
      rows.push({
        key: `coverage-${group.key}`,
        area: `${group.label} Coverage`,
        periodValue: group.coveragePercent !== null ? `${group.coveragePercent}%` : "Setup Required",
        change: null,
        coverage: `${group.snapshotsWithData}/${group.snapshotsWithData + group.snapshotsWithoutData} days`,
        reason: group.status === "Setup Required" ? "Source Missing" : (group.status === "No Data" ? "Source Missing" : "Partial Coverage"),
        source: group.label,
        onViewRecords: () => openDrillDown({ title: `${group.label} Records`, fieldLabel: null, fieldKey: null, source: getRecordsForGroup(rangedRecords, group.key, { quoteOpsHasDataByDate }) })
      });
    });

    const abandonedTotal = aggregateMetric(seriesFor(rangedRecords, "calls_abandoned"), AGGREGATION_MODES.PERIOD_TOTAL, { additive: true });
    if (abandonedTotal && abandonedTotal.value > 0) {
      rows.push({
        key: "calls-abandoned",
        area: "Calls Abandoned",
        periodValue: formatNumber(abandonedTotal.value),
        change: null,
        coverage: `${abandonedTotal.contributingCount} days with data`,
        reason: "Current Period",
        source: "Contact Center",
        onViewRecords: () => openDrillDown({ title: "Calls Abandoned", fieldLabel: "Calls Abandoned", fieldKey: "calls_abandoned", source: rangedRecords })
      });
    }

    const latestEscalations = [...rangedRecords].sort((a, b) => b.date.localeCompare(a.date))
      .find(r => isFiniteNumber(r.open_critical_escalations));
    if (latestEscalations && latestEscalations.open_critical_escalations > 0) {
      rows.push({
        key: "open-critical-escalations",
        area: "Open Critical Escalations",
        periodValue: formatNumber(latestEscalations.open_critical_escalations),
        change: null,
        coverage: `As of ${formatDateLabel(latestEscalations.date)}`,
        reason: "Review Recommended",
        source: "Escalations",
        onViewRecords: () => openDrillDown({ title: "Open Critical Escalations", fieldLabel: "Open Critical Escalations", fieldKey: "open_critical_escalations", source: rangedRecords })
      });
    }

    const latestOverdue = [...rangedRecords].sort((a, b) => b.date.localeCompare(a.date))
      .find(r => isFiniteNumber(r.overdue_follow_ups));
    if (latestOverdue && latestOverdue.overdue_follow_ups > 0) {
      rows.push({
        key: "overdue-follow-ups",
        area: "Overdue Follow-Ups",
        periodValue: formatNumber(latestOverdue.overdue_follow_ups),
        change: null,
        coverage: `As of ${formatDateLabel(latestOverdue.date)}`,
        reason: "Review Recommended",
        source: "Escalations",
        onViewRecords: () => openDrillDown({ title: "Overdue Follow-Ups", fieldLabel: "Overdue Follow-Ups", fieldKey: "overdue_follow_ups", source: rangedRecords })
      });
    }

    return rows;
  }, [quoteBacklog, caseBacklog, coverage, sourceCoverageResults, rangedRecords, quoteOpsHasDataByDate]);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O&amp;M Executive Overview</CardTitle>
          <p className="text-sm text-slate-500">
            Historical, range-aware summary across imports and manual entry. See the Daily Snapshot Report tab for
            the full exportable single-day narrative report.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span>
              Last stored or imported: {lastStoredOrImportedAt ? new Date(lastStoredOrImportedAt).toLocaleString() : "Never"}
            </span>
            <span>
              Overall source coverage: {overallCoverage !== null ? `${overallCoverage}%` : "N/A - no configured sources in range"}
            </span>
          </div>
        </CardContent>
      </Card>

      <DashboardDateRange records={records} value={activeRange} onChange={setRangeValue} />

      <Card className="border-slate-200">
        <CardContent className="flex flex-wrap items-center gap-6 p-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-slate-500">KPI Display Mode</Label>
            <ToggleGroup type="single" size="sm" value={kpiMode} onValueChange={(v) => v && setKpiMode(v)}>
              {AGGREGATION_MODE_OPTIONS.map(opt => (
                <ToggleGroupItem key={opt.value} value={opt.value} aria-label={opt.label}>{opt.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="compare-toggle" checked={compareEnabled} onCheckedChange={setCompareEnabled} disabled={!previousRange} />
            <Label htmlFor="compare-toggle" className="text-sm text-slate-600">
              Compare to Previous Period{!previousRange && " (not applicable to All Available History)"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {primaryResults.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No KPI data available for this reporting period yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {primaryResults.map(({ def, result }) => (
            <KpiCard
              key={def.key}
              def={def}
              result={result}
              showComparison={compareEnabled && Boolean(previousRange)}
              onViewRecords={() => openDrillDown({ title: def.label, fieldLabel: def.label, fieldKey: def.fieldKey || null, source: rangedRecords })}
            />
          ))}
          <BacklogCard
            label="Quote Backlog"
            icon={Layers}
            iconClass="bg-fuchsia-50 text-fuchsia-600"
            backlog={quoteBacklog}
            showComparison={compareEnabled && Boolean(previousRange)}
            direction="lowerIsBetter"
            onViewRecords={() => openDrillDown({ title: "Quote Backlog", fieldLabel: null, fieldKey: null, source: rangedRecords })}
          />
        </div>
      )}

      {secondaryResults.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-600">More Metrics</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {secondaryResults.map(({ def, result }) => (
              <KpiCard
                key={def.key}
                def={def}
                result={result}
                showComparison={compareEnabled && Boolean(previousRange)}
                onViewRecords={() => openDrillDown({ title: def.label, fieldLabel: def.label, fieldKey: def.fieldKey || null, source: rangedRecords })}
              />
            ))}
            <BacklogCard
              label="O&M Case Backlog"
              icon={HeartHandshake}
              iconClass="bg-sky-50 text-sky-600"
              backlog={caseBacklog}
              showComparison={compareEnabled && Boolean(previousRange)}
              direction="lowerIsBetter"
              onViewRecords={() => openDrillDown({ title: "O&M Case Backlog", fieldLabel: "Case Backlog at End", fieldKey: "case_backlog_end", source: rangedRecords })}
            />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Historical Operations Trend</h2>
        <ExecutiveOverviewCharts records={rangedRecords} quoteOpsSeries={quoteOpsSeries} />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">Source Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source Group</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Latest Date with Data</TableHead>
                <TableHead>Latest Import</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceCoverageResults.map(group => (
                <TableRow key={group.key}>
                  <TableCell className="font-medium text-slate-800">{group.label}</TableCell>
                  <TableCell><SourceCoverageBar percent={group.coveragePercent} /></TableCell>
                  <TableCell className="text-slate-500">{group.latestDateWithData ? formatDateLabel(group.latestDateWithData) : "\u2014"}</TableCell>
                  <TableCell className="text-slate-500">{group.latestImportAt ? new Date(group.latestImportAt).toLocaleDateString() : "\u2014"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={group.status === "Full Coverage" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                      {group.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={group.status === "Setup Required"}
                      onClick={() => openDrillDown({ title: `${group.label} Records`, fieldLabel: null, fieldKey: null, source: getRecordsForGroup(rangedRecords, group.key, { quoteOpsHasDataByDate }) })}
                    >
                      View Records
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RequiresAttentionTable rows={attentionRows} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-600">Additional Trends (AHT, Emails, Staffing)</h3>
        <MetricsTrendCharts records={records} />
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-600">History</h3>
        <MetricsHistoryTable records={rangedRecords} onEdit={onEditRecord} onChanged={onChanged} />
      </div>

      <DrillDownDrawer
        open={Boolean(drillDown)}
        onOpenChange={(open) => { if (!open) setDrillDown(null); }}
        title={drillDown?.title}
        fieldLabel={drillDown?.fieldLabel}
        fieldKey={drillDown?.fieldKey}
        records={drillDown?.records || []}
      />
    </div>
  );
}
