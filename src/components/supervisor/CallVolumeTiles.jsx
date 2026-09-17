import { useMemo } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { formatNumber } from "@/features/supervisorDashboard/format";

/**
 * Total Call Volume + Abandoned Calls tiles for Executive Overview, sourced from
 * the two raw, row-per-call Report Data tables ("Call Volume - Total" and
 * "Call Volume - Abandoned") instead of Incorta's fixed 5-day pivoted summary
 * widgets. Because every imported row carries its own real call timestamp, both
 * tiles recalculate live for whatever date range is selected here - unlike the
 * pivoted widgets, which are locked to whatever fixed window was exported.
 *
 * Both Skillname values (NA-US-ENG-O_M Pronto Tier1, NA-US-ENG-Sales-
 * EnphaseCare) are combined into ONE grand total per tile, matching Incorta's
 * own "Total" row - not split out per team.
 *
 * Read-only: only ever reads via listReportTables() (passed in as `reportTables`
 * by the parent); never writes back to Report Data's own tables.
 */

// Matches Incorta's raw export date format, e.g. "9/1/26 3:14:33 PM" or
// "9/1/26 3:14:33 AM" - 1-2 digit month/day, 2-digit year, optional time with
// AM/PM. Returns a plain "YYYY-MM-DD" string (date portion only) or null if the
// text doesn't match. Deliberately separate from reportParsing.js's
// parseDateCell, which targets FIELD_DEFINITIONS-mapped imports (4-digit years,
// no embedded time) - not stretching that existing, tested function to also
// cover this different raw format.
function parseIncortaRawDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/i);
  if (!match) return null;
  const [, m, d, y] = match;
  const year = 2000 + Number(y);
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Column names vary slightly between the two report types (both use
// "Contact Start Time (PST)" today per the confirmed Incorta export), matched
// case-insensitively/trimmed so small header differences don't silently break
// date filtering.
function findColumnKey(row, candidates) {
  const keys = Object.keys(row || {});
  for (const candidate of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

function parseWaitMinutes(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "--") return null;
  const parsed = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function filterRowsInRange(rows, startDate, endDate) {
  if (!rows?.length) return [];
  return rows.filter((row) => {
    const dateKey = findColumnKey(row, ["Contact Start Time (PST)", "Contactstartdatetime(UTC)", "Date"]);
    if (!dateKey) return false;
    const date = parseIncortaRawDate(row[dateKey]);
    if (!date) return false;
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  });
}

function ReportCountTile({ icon: Icon, label, count, sublabel, accentClass }) {
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accentClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs text-muted-foreground">Selected Period</span>
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{formatNumber(count)}</p>
      {sublabel && <p className="mt-1 text-[11px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

/**
 * @param {object} reportTables - result of importedTableStore.js's listReportTables().
 * @param {string|null} startDate - "YYYY-MM-DD", inclusive - the Executive Overview's
 *   currently selected reporting period start. Null = no lower bound.
 * @param {string|null} endDate - "YYYY-MM-DD", inclusive - currently selected end. Null = no upper bound.
 */
export default function CallVolumeTiles({ reportTables = {}, startDate = null, endDate = null }) {
  const totalRows = useMemo(
    () => filterRowsInRange(reportTables?.call_volume_total?.rows, startDate, endDate),
    [reportTables, startDate, endDate]
  );
  const abandonedRows = useMemo(
    () => filterRowsInRange(reportTables?.call_volume_abandoned?.rows, startDate, endDate),
    [reportTables, startDate, endDate]
  );

  const avgWaitMinutes = useMemo(() => {
    if (!abandonedRows.length) return null;
    let sum = 0;
    let count = 0;
    abandonedRows.forEach((row) => {
      const waitKey = findColumnKey(row, ["Wait_Time(min)", "Wait Time (min)", "Wait_Time(mins)"]);
      const minutes = waitKey ? parseWaitMinutes(row[waitKey]) : null;
      if (minutes !== null) {
        sum += minutes;
        count += 1;
      }
    });
    return count > 0 ? sum / count : null;
  }, [abandonedRows]);

  // Hidden entirely (not a zero-filled tile) if neither report has been imported
  // yet - consistent with the "hide, don't show N/A" rule from the Report Data
  // filter tiles.
  const hasTotalData = Boolean(reportTables?.call_volume_total?.rows?.length);
  const hasAbandonedData = Boolean(reportTables?.call_volume_abandoned?.rows?.length);
  if (!hasTotalData && !hasAbandonedData) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {hasTotalData && (
        <ReportCountTile
          icon={Phone}
          label="Total Call Volume"
          count={totalRows.length}
          sublabel="Handled + Abandoned - both teams combined"
          accentClass="bg-indigo-50 text-indigo-600"
        />
      )}
      {hasAbandonedData && (
        <ReportCountTile
          icon={PhoneOff}
          label="Abandoned Calls"
          count={abandonedRows.length}
          sublabel={avgWaitMinutes !== null ? `Avg. Wait Time: ${avgWaitMinutes.toFixed(1)} min` : "No wait time data in this period"}
          accentClass="bg-rose-50 text-rose-600"
        />
      )}
    </div>
  );
}