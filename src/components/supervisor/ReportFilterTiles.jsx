import { useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/features/supervisorDashboard/format";

// Matches the exact 7 report types defined in ReportDataTablesPanel.jsx's
// REPORT_TYPES array - kept as a separate constant here (rather than imported)
// so this file stays independent of that panel's internals, same pattern the
// codebase already uses elsewhere (e.g. importedTableStore.js vs opsMetricsStore.js
// intentionally not importing from each other).
const REPORT_LABELS = {
  escalations: "Escalations",
  audits: "Audits",
  care_cases: "Care-Cases",
  om_cs_cases: "O&M-CS-Cases",
  incorta_input: "Incorta-O&M-Input",
  sfdc_quotes: "SFDC-Quotes",
  care_subscriptions: "Care Subscriptions"
};
const REPORT_ORDER = Object.keys(REPORT_LABELS);

// The Escalations severity column - matched case-insensitively against whatever
// columns actually exist on an imported row, since imported spreadsheet column
// casing can vary (see careEligibility.js's own precedent for case-sensitive-column
// caution - here we deliberately go the other way and normalize, since "Severity"
// values themselves (S1/S2/S3/etc.) are what must stay a "full set", not a fixed list).
function findSeverityKey(row) {
  return Object.keys(row || {}).find((key) => key.trim().toLowerCase() === "severity") || null;
}

/** Simple, self-contained tile - visually consistent with the existing KpiCard / LiveCountCard style. */
function ReportCountTile({ label, count, sublabel }) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Table2 className="h-4 w-4" />
        </div>
        <span className="text-xs text-muted-foreground">Snapshot</span>
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{formatNumber(count)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-border bg-card text-[10px] text-muted-foreground">Live Count</Badge>
      </div>
      {sublabel && <p className="mt-1 text-[11px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

/**
 * Configurable Report Data filter + tiles for the Executive Overview tab.
 *
 * - Defaults to ALL 7 report types selected ("All Reports" aggregate view).
 * - Each selected report renders as its own tile showing a live total row count -
 *   completely separate from (and never written back to) Report Data's own table
 *   view, and separate from the date-ranged daily-metric KPI tiles above it.
 * - A report with no imported data yet, or not currently selected, renders NO tile
 *   at all (no "N/A"/zero placeholder) - only useful, actionable counts are shown.
 * - Escalations is a deliberate special case: instead of one combined total, it
 *   renders one full tile PER SEVERITY VALUE actually present in the imported data
 *   (grouped live, not a hardcoded S1/S2/S3 list), per explicit user requirement.
 *
 * @param {object} reportTables - result of importedTableStore.js's listReportTables(),
 *   already fetched read-only by the parent (DashboardOverview.jsx) via react-query.
 */
export default function ReportFilterTiles({ reportTables = {} }) {
  const [selected, setSelected] = useState(() => new Set(REPORT_ORDER));

  function toggleReport(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(REPORT_ORDER));
  }

  const escalationSeverityTiles = useMemo(() => {
    if (!selected.has("escalations")) return [];
    const table = reportTables?.escalations;
    if (!table?.rows?.length) return [];
    const counts = new Map();
    table.rows.forEach((row) => {
      const key = findSeverityKey(row);
      const raw = key ? String(row[key] ?? "").trim() : "";
      const value = raw || "Unspecified";
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    // Sort by count desc so the most common severity leads, but never drops any
    // severity value actually present in the data - a true "full set".
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([severity, count]) => ({ severity, count }));
  }, [selected, reportTables]);

  const otherReportTiles = useMemo(() => {
    return REPORT_ORDER.filter((key) => key !== "escalations")
      .filter((key) => selected.has(key))
      .map((key) => {
        const table = reportTables?.[key];
        const count = table?.rows?.length ?? 0;
        return { key, label: REPORT_LABELS[key], count, hasData: Boolean(table?.rows?.length) };
      })
      .filter((entry) => entry.hasData); // hide reports with no imported data yet
  }, [selected, reportTables]);

  const hasAnyTile = escalationSeverityTiles.length > 0 || otherReportTiles.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Report Data Filter</h3>
        <button type="button" onClick={selectAll} className="text-xs font-medium text-indigo-600 hover:underline">
          Select All Reports
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REPORT_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleReport(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              selected.has(key)
                ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700"
                : "border-border bg-secondary text-muted-foreground hover:bg-accent"
            }`}
          >
            {REPORT_LABELS[key]}
          </button>
        ))}
      </div>

      {!hasAnyTile ? (
        <p className="py-4 text-sm text-muted-foreground">
          No imported Report Data available yet for the selected report(s).
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {escalationSeverityTiles.map(({ severity, count }) => (
            <ReportCountTile
              key={`escalations-${severity}`}
              label={`Escalations - ${severity}`}
              count={count}
              sublabel="Report Data: Escalations"
            />
          ))}
          {otherReportTiles.map(({ key, label, count }) => (
            <ReportCountTile key={key} label={label} count={count} sublabel="Report Data" />
          ))}
        </div>
      )}
    </div>
  );
}