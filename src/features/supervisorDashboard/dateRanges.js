/**
 * Historical reporting-period resolution for the Executive Overview.
 *
 * Every helper here works purely off "YYYY-MM-DD" local-calendar strings (the same convention
 * `opsMetricsStore.js`/`format.js` already use) - never `Date` objects crossing a timezone
 * boundary - so a selected range never silently shifts by a day depending on the viewer's clock.
 *
 * This module never fabricates records or dates: it only resolves which start/end date strings
 * a preset means, and reports how many of the *stored* records fall inside that window. Whether
 * a date actually has a snapshot is entirely up to the caller's own `records` array.
 */

export const RANGE_PRESETS = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  SINGLE_DAY: "single_day",
  LAST_7_DAYS: "last_7_days",
  LAST_30_DAYS: "last_30_days",
  MONTH_TO_DATE: "month_to_date",
  PREVIOUS_MONTH: "previous_month",
  THIS_QUARTER: "this_quarter",
  LAST_QUARTER: "last_quarter",
  YEAR_TO_DATE: "year_to_date",
  CUSTOM_RANGE: "custom_range",
  ALL_HISTORY: "all_history"
};

export const RANGE_PRESET_OPTIONS = [
  { value: RANGE_PRESETS.TODAY, label: "Today" },
  { value: RANGE_PRESETS.YESTERDAY, label: "Yesterday" },
  { value: RANGE_PRESETS.SINGLE_DAY, label: "Single Day" },
  { value: RANGE_PRESETS.LAST_7_DAYS, label: "Last 7 Days" },
  { value: RANGE_PRESETS.LAST_30_DAYS, label: "Last 30 Days" },
  { value: RANGE_PRESETS.MONTH_TO_DATE, label: "Month to Date" },
  { value: RANGE_PRESETS.PREVIOUS_MONTH, label: "Previous Month" },
  { value: RANGE_PRESETS.THIS_QUARTER, label: "This Quarter" },
  { value: RANGE_PRESETS.LAST_QUARTER, label: "Last Quarter" },
  { value: RANGE_PRESETS.YEAR_TO_DATE, label: "Year to Date" },
  { value: RANGE_PRESETS.CUSTOM_RANGE, label: "Custom Range" },
  { value: RANGE_PRESETS.ALL_HISTORY, label: "All Available History" }
];

const PRESET_LABELS = Object.fromEntries(RANGE_PRESET_OPTIONS.map(opt => [opt.value, opt.label]));

export function getPresetLabel(preset) {
  return PRESET_LABELS[preset] || preset;
}

function parseDateStr(dateStr) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(dateStr, deltaDays) {
  const date = parseDateStr(dateStr);
  if (!date) return dateStr;
  date.setDate(date.getDate() + deltaDays);
  return toDateStr(date);
}

/** Inclusive count of calendar days between two "YYYY-MM-DD" strings (order-independent). */
export function diffDays(startDateStr, endDateStr) {
  const start = parseDateStr(startDateStr);
  const end = parseDateStr(endDateStr);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function firstOfMonth(dateStr) {
  const [year, month] = String(dateStr || "").split("-");
  return `${year}-${month}-01`;
}

function firstOfPreviousMonth(dateStr) {
  const date = parseDateStr(firstOfMonth(dateStr));
  if (!date) return null;
  date.setMonth(date.getMonth() - 1);
  return toDateStr(date);
}

function lastDayOfMonth(firstOfMonthStr) {
  const date = parseDateStr(firstOfMonthStr);
  if (!date) return null;
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return toDateStr(date);
}

/** First day ("YYYY-MM-DD") of the CALENDAR quarter (Jan-Mar/Apr-Jun/Jul-Sep/Oct-Dec)
 *  containing `dateStr`. */
function firstOfQuarter(dateStr) {
  const date = parseDateStr(dateStr);
  if (!date) return null;
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return toDateStr(new Date(date.getFullYear(), quarterStartMonth, 1));
}

/** Last day ("YYYY-MM-DD") of the calendar quarter that starts on `firstOfQuarterStr`. */
function lastDayOfQuarter(firstOfQuarterStr) {
  const date = parseDateStr(firstOfQuarterStr);
  if (!date) return null;
  date.setMonth(date.getMonth() + 3);
  date.setDate(0);
  return toDateStr(date);
}

/** First day ("YYYY-MM-DD") of the calendar quarter immediately BEFORE the one containing
 *  `dateStr`. */
function firstOfPreviousQuarter(dateStr) {
  const currentQuarterStart = parseDateStr(firstOfQuarter(dateStr));
  if (!currentQuarterStart) return null;
  currentQuarterStart.setMonth(currentQuarterStart.getMonth() - 3);
  return toDateStr(currentQuarterStart);
}

/** Sorted, de-duplicated list of every "YYYY-MM-DD" date present in `records`. */
export function getRecordDates(records) {
  const dates = new Set((records || []).map(record => record?.date).filter(Boolean));
  return Array.from(dates).sort();
}

/**
 * Default reporting period per spec: Last 30 Days once at least two dated records exist,
 * otherwise Single Day (there's nothing meaningful to range across with 0-1 stored days).
 */
export function resolveDefaultPreset(records) {
  return getRecordDates(records).length >= 2 ? RANGE_PRESETS.LAST_30_DAYS : RANGE_PRESETS.SINGLE_DAY;
}

/**
 * Resolves a preset (plus optional explicit start/end for Custom Range, and an end-date anchor
 * for every other preset) into a concrete { start, end } inclusive date-string range.
 *
 * `endDate` anchors every preset except Custom Range/All Available History - it defaults to the
 * most recent stored record's date, or today if there are no records yet at all.
 */
export function resolveDateRange({ preset, endDate, startDate, records = [] } = {}) {
  const recordDates = getRecordDates(records);
  const latestRecordDate = recordDates[recordDates.length - 1] || null;
  const earliestRecordDate = recordDates[0] || null;
  const effectiveEnd = endDate || todayStr();

  switch (preset) {
    // TODAY/YESTERDAY intentionally anchor to the REAL current date (the user's own computer
    // clock, via todayStr()) rather than `effectiveEnd` - unlike every other preset here, which
    // anchors to the latest STORED record's date so historical data still makes sense to browse.
    // "Today" should always mean today, even if the most recent import is stale.
    case RANGE_PRESETS.TODAY: {
      const today = todayStr();
      return { start: today, end: today, isInvalid: false };
    }

    case RANGE_PRESETS.YESTERDAY: {
      const yesterday = addDays(todayStr(), -1);
      return { start: yesterday, end: yesterday, isInvalid: false };
    }

    case RANGE_PRESETS.SINGLE_DAY:
      return { start: effectiveEnd, end: effectiveEnd, isInvalid: false };

    case RANGE_PRESETS.LAST_7_DAYS:
      return { start: addDays(effectiveEnd, -6), end: effectiveEnd, isInvalid: false };

    case RANGE_PRESETS.LAST_30_DAYS:
      return { start: addDays(effectiveEnd, -29), end: effectiveEnd, isInvalid: false };

    case RANGE_PRESETS.MONTH_TO_DATE:
      return { start: firstOfMonth(effectiveEnd), end: effectiveEnd, isInvalid: false };

    case RANGE_PRESETS.PREVIOUS_MONTH: {
      const start = firstOfPreviousMonth(effectiveEnd);
      return { start, end: lastDayOfMonth(start), isInvalid: false };
    }

    case RANGE_PRESETS.THIS_QUARTER: {
      const start = firstOfQuarter(effectiveEnd);
      return { start, end: effectiveEnd, isInvalid: false };
    }

    case RANGE_PRESETS.LAST_QUARTER: {
      const start = firstOfPreviousQuarter(effectiveEnd);
      return { start, end: lastDayOfQuarter(start), isInvalid: false };
    }

    case RANGE_PRESETS.YEAR_TO_DATE: {
      const [year] = String(effectiveEnd).split("-");
      return { start: `${year}-01-01`, end: effectiveEnd, isInvalid: false };
    }

    case RANGE_PRESETS.CUSTOM_RANGE: {
      const start = startDate || effectiveEnd;
      const end = endDate || effectiveEnd;
      return { start, end, isInvalid: diffDays(start, end) < 0 };
    }

    case RANGE_PRESETS.ALL_HISTORY:
      return {
        start: earliestRecordDate || effectiveEnd,
        end: latestRecordDate || effectiveEnd,
        isInvalid: false
      };

    default:
      return { start: effectiveEnd, end: effectiveEnd, isInvalid: false };
  }
}

/**
 * The immediately preceding, equivalent-length calendar period for a resolved range - per spec,
 * Single Day/Last 7/Last 30/Custom Range all just shift the whole window back by its own length;
 * Month to Date and Previous Month need their own calendar-aware logic. All Available History has
 * no meaningful "previous period" (there's nothing before "everything").
 */
export function getPreviousPeriodRange({ preset, start, end }) {
  if (preset === RANGE_PRESETS.ALL_HISTORY) return null;
  if (!start || !end) return null;

  if (preset === RANGE_PRESETS.MONTH_TO_DATE) {
    const elapsedDays = diffDays(start, end) + 1;
    const prevMonthFirst = firstOfPreviousMonth(start);
    const prevMonthLast = lastDayOfMonth(prevMonthFirst);
    const candidateEnd = addDays(prevMonthFirst, elapsedDays - 1);
    return { start: prevMonthFirst, end: diffDays(candidateEnd, prevMonthLast) < 0 ? prevMonthLast : candidateEnd };
  }

  if (preset === RANGE_PRESETS.PREVIOUS_MONTH) {
    const prevPrevFirst = firstOfPreviousMonth(start);
    return { start: prevPrevFirst, end: lastDayOfMonth(prevPrevFirst) };
  }

  if (preset === RANGE_PRESETS.THIS_QUARTER) {
    const prevQuarterFirst = firstOfPreviousQuarter(start);
    return { start: prevQuarterFirst, end: lastDayOfQuarter(prevQuarterFirst) };
  }

  if (preset === RANGE_PRESETS.LAST_QUARTER) {
    const prevPrevQuarterFirst = firstOfPreviousQuarter(start);
    return { start: prevPrevQuarterFirst, end: lastDayOfQuarter(prevPrevQuarterFirst) };
  }

  if (preset === RANGE_PRESETS.YEAR_TO_DATE) {
    const elapsedDays = diffDays(start, end) + 1;
    const [year] = String(start).split("-");
    const prevYearStart = `${Number(year) - 1}-01-01`;
    return { start: prevYearStart, end: addDays(prevYearStart, elapsedDays - 1) };
  }

  const durationDays = diffDays(start, end) + 1;
  return { start: addDays(start, -durationDays), end: addDays(end, -durationDays) };
}

/**
 * How many of `records` actually fall in [start, end], and how many calendar dates in that
 * window have no stored snapshot at all - never fabricated, just counted.
 */
export function describeRangeCoverage(records, { start, end }) {
  const totalCalendarDays = diffDays(start, end) + 1;
  const datesInRange = (records || [])
    .map(record => record?.date)
    .filter(date => date && date >= start && date <= end);
  const distinctDates = new Set(datesInRange);
  return {
    totalCalendarDays,
    snapshotCount: distinctDates.size,
    missingDateCount: Math.max(0, totalCalendarDays - distinctDates.size)
  };
}

/** Records whose `date` falls inside [start, end], sorted chronologically. */
export function filterRecordsInRange(records, { start, end }) {
  return (records || [])
    .filter(record => record?.date && record.date >= start && record.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}
