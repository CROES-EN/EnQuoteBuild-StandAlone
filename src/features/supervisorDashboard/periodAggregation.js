/**
 * Metric-aggregation primitives for the Executive Overview's historical reporting period.
 *
 * Every function here is deliberately generic over `{ date, value }` entry arrays (already
 * filtered to the selected range and sorted chronologically by the caller - see
 * `filterRecordsInRange` in `dateRanges.js`) rather than hard-coding field names, so the same
 * math works for opsMetricsStore fields AND live-computed Quote Operations figures.
 *
 * Nothing here fabricates a value: every aggregate returns `null` (never 0, never a guess) when
 * there is no valid contributing data, per the O&M reporting spec's "never create synthetic
 * values" rule. Zero is always treated as a real, valid value - only `null`/`undefined`/`NaN`
 * are treated as missing.
 */

export const AGGREGATION_MODES = {
  PERIOD_TOTAL: "period_total",
  DAILY_AVERAGE: "daily_average",
  LATEST_DAY: "latest_day"
};

export const AGGREGATION_MODE_OPTIONS = [
  { value: AGGREGATION_MODES.PERIOD_TOTAL, label: "Period Total" },
  { value: AGGREGATION_MODES.DAILY_AVERAGE, label: "Daily Average" },
  { value: AGGREGATION_MODES.LATEST_DAY, label: "Latest Day" }
];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validEntries(entries) {
  return (entries || []).filter(entry => isFiniteNumber(entry?.value));
}

/** Sum of every valid value in `entries` - the metric must be additive (see caller's KPI metadata). */
export function periodTotal(entries) {
  const valid = validEntries(entries);
  if (!valid.length) return null;
  return { value: valid.reduce((sum, entry) => sum + entry.value, 0), contributingCount: valid.length };
}

/**
 * Average across only the stored records that actually have a valid value for this metric -
 * never divides by the number of calendar dates in the range, missing or not.
 */
export function dailyAverage(entries) {
  const valid = validEntries(entries);
  if (!valid.length) return null;
  const total = valid.reduce((sum, entry) => sum + entry.value, 0);
  return { value: total / valid.length, contributingCount: valid.length };
}

/** Most recent record in the range that actually has this metric - reports which date it came from. */
export function latestDay(entries) {
  const sorted = [...(entries || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isFiniteNumber(sorted[i].value)) {
      return { value: sorted[i].value, date: sorted[i].date, contributingCount: 1 };
    }
  }
  return null;
}

/**
 * Dispatches to the right primitive for a KPI's selected display mode. `additive` gates whether
 * Period Total is a mathematically valid operation for this metric at all (e.g. never true for
 * backlog snapshots, rates, headcounts, or AHT) - callers should hide the mode entirely rather
 * than call this function with an inapplicable mode, but this still guards against it.
 */
export function aggregateMetric(entries, mode, { additive = true } = {}) {
  if (mode === AGGREGATION_MODES.PERIOD_TOTAL) {
    return additive ? periodTotal(entries) : null;
  }
  if (mode === AGGREGATION_MODES.DAILY_AVERAGE) return dailyAverage(entries);
  if (mode === AGGREGATION_MODES.LATEST_DAY) return latestDay(entries);
  return null;
}

/**
 * Opening Backlog = earliest valid "backlog at start" value in the range. Backlog is a
 * point-in-time snapshot, so this is a lookup, never a sum.
 */
export function resolveOpeningBacklog(startSeriesEntries) {
  const sorted = [...(startSeriesEntries || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const found = sorted.find(entry => isFiniteNumber(entry.value));
  return found ? { value: found.value, date: found.date } : null;
}

/** Closing Backlog = latest valid "backlog at end" value in the range. */
export function resolveClosingBacklog(endSeriesEntries) {
  const sorted = [...(endSeriesEntries || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isFiniteNumber(sorted[i].value)) return { value: sorted[i].value, date: sorted[i].date };
  }
  return null;
}

/** Net Backlog Movement = Closing - Opening. Never computed when either side is unavailable. */
export function computeNetBacklogMovement(opening, closing) {
  if (!opening || !closing) return null;
  return closing.value - opening.value;
}

/**
 * Recalculates a rate from period component totals (e.g. Abandon Rate = Total Calls Abandoned /
 * Total Calls Offered) instead of averaging daily percentages, per spec. Returns null
 * ("Metric Unavailable") when either total is unavailable or the denominator totals to zero.
 */
export function computeRateFromTotals(numeratorEntries, denominatorEntries) {
  const numerator = periodTotal(numeratorEntries);
  const denominator = periodTotal(denominatorEntries);
  if (!numerator || !denominator || denominator.value === 0) return null;
  return {
    rate: numerator.value / denominator.value,
    numeratorTotal: numerator.value,
    denominatorTotal: denominator.value
  };
}

/**
 * Duration-aware daily average (e.g. Average Handle Time): entries are expected to already be in
 * a single shared numeric unit (seconds, matching `aht_seconds`/`avg_wait_seconds`) - averaging
 * is identical to `dailyAverage`, this just documents the "convert -> average -> format" spec
 * requirement at the call site and is the one place duration KPIs should route through.
 */
export function dailyAverageDuration(entries) {
  return dailyAverage(entries);
}

/**
 * Current-vs-previous-period comparison. Distinguishes "no previous data at all" from "previous
 * value was genuinely zero" so the UI never divides by zero to produce a misleading percentage.
 */
export function comparePeriods(currentValue, previousValue) {
  if (currentValue === null || currentValue === undefined || Number.isNaN(currentValue)) return null;
  if (previousValue === null || previousValue === undefined || Number.isNaN(previousValue)) {
    return { change: null, percent: null, previousWasZero: false, hasPrevious: false };
  }
  const change = currentValue - previousValue;
  if (previousValue === 0) {
    return { change, percent: null, previousWasZero: true, hasPrevious: true };
  }
  return { change, percent: Math.round((change / previousValue) * 1000) / 10, previousWasZero: false, hasPrevious: true };
}
