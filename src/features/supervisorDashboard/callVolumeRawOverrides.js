/**
 * Corrects "calls" (Handled), "calls_abandoned", and "calls_offered" (Total Call Volume) per
 * calendar date using the reliable, row-level Report Data tables ("Call Volume - Total" and
 * "Call Volume - Abandoned") instead of the older CXONE daily-aggregate import path, which was
 * found to mislabel Incorta's pivoted "Total Call Volume (Handled + Abandoned)" widget as
 * "Calls Abandoned" (a header-collision limitation of that widget's dates-as-columns shape -
 * see reportParsing.js's mergeSheetRowSets for the root cause).
 *
 * Confirmed with the user:
 *   - "Call Volume - Total" (imported from Incorta's "NICE Call - RAW DATA" tab) = every call,
 *     both NA-US-ENG-O_M Pronto Tier1 and NA-US-ENG-Sales-EnphaseCare combined into one grand
 *     total per date - this is "Calls Offered" (Handled + Abandoned).
 *   - "Call Volume - Abandoned" (imported from Incorta's "Pronto-Abandoned Calls" tab) = already
 *     reliably pre-filtered by Incorta to abandoned-only calls - both teams combined.
 *   - "Calls Handled" = Total - Abandoned (never separately imported/summed on its own).
 *
 * A date is only overridden when the "Call Volume - Total" table has at least one row for it -
 * dates with no raw import yet keep their existing daily-metric value untouched, so running
 * this never erases or zeroes data for a date nobody has re-imported with the new raw sources.
 */

// Matches Incorta's raw export date format, e.g. "9/1/26 3:14:33 PM" - 1-2 digit month/day,
// 2-digit year, optional time with AM/PM. Returns "YYYY-MM-DD" or null. Deliberately separate
// from reportParsing.js's parseDateCell, which targets FIELD_DEFINITIONS-mapped imports
// (4-digit years, no embedded time), not this raw Report Data table format.
export function parseIncortaRawDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/i);
  if (!match) return null;
  const [, m, d, y] = match;
  const year = 2000 + Number(y);
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDateColumnKey(row) {
  const keys = Object.keys(row || {});
  const candidates = ["Contact Start Time (PST)", "Contactstartdatetime(UTC)", "Date"];
  for (const candidate of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

function countRowsByDate(rows) {
  const counts = {};
  (rows || []).forEach((row) => {
    const dateKey = findDateColumnKey(row);
    if (!dateKey) return;
    const date = parseIncortaRawDate(row[dateKey]);
    if (!date) return;
    counts[date] = (counts[date] || 0) + 1;
  });
  return counts;
}

/**
 * @param {object} reportTables - result of importedTableStore.js's listReportTables().
 * @returns {Object<string, {calls: number, calls_abandoned: number, calls_offered: number}>}
 *   Keyed by "YYYY-MM-DD" - only includes dates present in the "Call Volume - Total" table.
 */
export function computeCallVolumeOverridesByDate(reportTables) {
  // CONSOLIDATED PER USER INSTRUCTION: "Incorta-O&M-Input IS the Call Volume - Total
  // AND the Call Volume - Abandoned data... it should only have to import once." Both
  // totals now come from the SAME single "Incorta-O&M-Input" Report Data table instead
  // of two separate imports. "Call Volume - Total" / "Call Volume - Abandoned" report
  // types are left in place (harmless, unused) so nothing breaks if either was
  // previously imported.
  //
  // ABANDONED-CALL DETECTION - BEST GUESS, MUST BE VERIFIED:
  // A row is treated as abandoned when its agent-name-like column is blank/NaN,
  // matching the same rule used for the original raw NICE Call export. If
  // Incorta-O&M-Input's real column structure identifies abandoned calls differently
  // (e.g. a specific O&M Status value), this detection rule must be updated to match -
  // see findAbandonedIndicatorKey() below.
  const rows = reportTables?.incorta_input?.rows || [];
  const totalByDate = countRowsByDate(rows);
  const abandonedByDate = countAbandonedRowsByDate(rows);
  const overrides = {};
  Object.keys(totalByDate).forEach((date) => {
    const total = totalByDate[date];
    const abandoned = abandonedByDate[date] || 0;
    overrides[date] = {
      calls_offered: total,
      calls_abandoned: abandoned,
      calls: total // Total Calls = raw imported row count, per explicit user correction - NOT total minus abandoned.
    };
  });
  return overrides;
}

// Finds whichever column looks like an agent-name field (case-insensitive
// "agent" in the header) - a blank/NaN value there marks the call as
// abandoned, matching the original raw-export detection rule. If your real
// Incorta-O&M-Input data identifies abandoned calls a different way (a
// specific O&M Status value, etc.), update this function to match - do not
// guess further without confirming against real column headers first.
function findAbandonedIndicatorKey(row) {
  const keys = Object.keys(row || {});
  return keys.find((key) => /agent/i.test(key)) || null;
}

function isAbandonedRow(row) {
  const key = findAbandonedIndicatorKey(row);
  if (!key) return false;
  const value = String(row[key] ?? "").trim().toLowerCase();
  return value === "" || value === "nan";
}

function countAbandonedRowsByDate(rows) {
  return countRowsByDate((rows || []).filter(isAbandonedRow));
}