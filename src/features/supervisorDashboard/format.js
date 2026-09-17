/**
 * Shared display-formatting helpers for the Supervisor Dashboard.
 */

export function formatSecondsAsClock(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return "—";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateLabel(dateStr) {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  // Constructed from local calendar parts (not `new Date(dateStr)`) so the
  // displayed weekday/day never shifts based on the viewer's timezone.
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US");
}

/** Formats a 0-1 fraction as a percentage string, e.g. 0.1234 -> "12.3%". */
export function formatRate(rate) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "N/A";
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Formats a value with `formatter`, or `fallback` when the value is missing - lets report text
 * use a more explicit fallback (e.g. the O&M Snapshot spec's required "N/A - Source unavailable")
 * than the terser "—"/"N/A" used elsewhere in this feature's inline dashboard tiles.
 */
export function formatOrFallback(value, formatter = formatNumber, fallback = "—") {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return formatter(value);
}

/**
 * Computes a day-over-day delta for a metric.
 * @param {"higherIsBetter"|"lowerIsBetter"|"neutral"} direction - how to color the change.
 */
export function computeDelta(current, previous, direction = "higherIsBetter") {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  const change = current - previous;
  if (change === 0) return { change: 0, percent: 0, trend: "flat", direction };

  const percent = previous !== 0 ? Math.round((change / previous) * 1000) / 10 : null;
  const trend = change > 0 ? "up" : "down";
  return { change, percent, trend, direction };
}
